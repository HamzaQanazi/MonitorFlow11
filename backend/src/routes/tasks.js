// Tasks (CLAUDE.md Section 7): the employee's surface. Employees never call
// GET /requests/{id} — GET /tasks/{id} embeds the limited request data they
// are allowed to see (requester name + phone, never email; form_response
// stripped of visible_to_employee:false fields). All status mutations go
// through the workflow engine; nothing here writes a status.
const express = require('express');
const pool = require('../db');
const { requireAuth, requireRole } = require('../middleware/auth');
const {
  WorkflowError,
  statusOf,
  validTransitions,
  executeTransition,
} = require('../lib/workflowEngine');
const { validateFormResponse } = require('../lib/validateFormResponse');

const router = express.Router();
router.use(requireAuth);
// Monitor reads progress via REQUEST.status — there is no monitor-facing
// task endpoint (Section 5), so the whole router is employee-only.
router.use(requireRole('employee'));

const CATEGORIES = ['new', 'triage', 'in_progress', 'done', 'closed', 'terminated'];
const PRIORITIES = ['low', 'medium', 'high'];
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// The Section 6 "limited fields" mechanism: drop every form field whose
// schema says visible_to_employee: false (absent means visible).
function stripHiddenFields(fieldSchema, formResponse) {
  const out = {};
  for (const f of fieldSchema) {
    if (f.visible_to_employee === false) continue;
    if (formResponse[f.id] !== undefined) out[f.id] = formResponse[f.id];
  }
  return out;
}

// Loads a task with its request/workflow context, enforcing ownership with
// 404 (a valid id owned by another employee must look nonexistent).
async function loadOwnTask(id, employeeId) {
  if (!Number.isInteger(id)) throw new WorkflowError(404, 'Not found');
  const { rows } = await pool.query(
    `SELECT t.id, t.employee_id, t.request_id, t.assigned_at, t.completion_form_response,
            r.status, r.priority, r.form_response, r.created_at AS request_created_at,
            r.service_type_id, st.name AS service_type_name,
            w.statuses, w.transitions,
            u.name AS requester_name, u.phone AS requester_phone
     FROM task t
     JOIN request r ON r.id = t.request_id
     JOIN service_type st ON st.id = r.service_type_id
     JOIN workflow_definition w ON w.service_type_id = r.service_type_id
     JOIN users u ON u.id = r.user_id
     WHERE t.id = $1`,
    [id]
  );
  if (!rows.length || rows[0].employee_id !== employeeId) {
    throw new WorkflowError(404, 'Not found');
  }
  return rows[0];
}

// GET /tasks?employeeId=me — own tasks only, standard list params.
router.get('/', async (req, res, next) => {
  try {
    const q = req.query;
    const page = q.page === undefined ? 1 : Number(q.page);
    const pageSize = q.pageSize === undefined ? 20 : Number(q.pageSize);
    const bad = [];
    if (!Number.isInteger(page) || page < 1) bad.push('page');
    if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > 100) bad.push('pageSize');
    if (q.category !== undefined && !CATEGORIES.includes(q.category)) bad.push('category');
    if (q.priority !== undefined && !PRIORITIES.includes(q.priority)) bad.push('priority');
    if (q.serviceTypeId !== undefined && !Number.isInteger(Number(q.serviceTypeId))) bad.push('serviceTypeId');
    if (q.dateFrom !== undefined && !DATE_RE.test(q.dateFrom)) bad.push('dateFrom');
    if (q.dateTo !== undefined && !DATE_RE.test(q.dateTo)) bad.push('dateTo');
    if (bad.length) return res.status(400).json({ error: `Invalid query params: ${bad.join(', ')}` });

    const where = ['t.employee_id = $1'];
    const params = [req.user.id];
    const add = (sql, value) => {
      params.push(value);
      where.push(sql.replaceAll('?', `$${params.length}`));
    };
    if (q.status !== undefined) add('r.status = ?', q.status);
    if (q.category !== undefined) add("s->>'category' = ?", q.category);
    if (q.serviceTypeId !== undefined) add('r.service_type_id = ?', Number(q.serviceTypeId));
    if (q.priority !== undefined) add('r.priority = ?', q.priority);
    if (q.dateFrom !== undefined) add('t.assigned_at >= ?::date', q.dateFrom);
    if (q.dateTo !== undefined) add("t.assigned_at < ?::date + INTERVAL '1 day'", q.dateTo);
    if (q.q) add('st.name ILIKE ?', `%${q.q}%`);

    params.push(pageSize, (page - 1) * pageSize);
    const { rows } = await pool.query(
      `SELECT t.id, t.request_id, t.assigned_at,
              r.service_type_id, st.name AS service_type_name,
              r.status, s->>'label' AS status_label, s->>'category' AS category,
              r.priority, r.created_at AS request_created_at,
              COUNT(*) OVER()::int AS total
       FROM task t
       JOIN request r ON r.id = t.request_id
       JOIN service_type st ON st.id = r.service_type_id
       JOIN workflow_definition w ON w.service_type_id = r.service_type_id
       JOIN LATERAL jsonb_array_elements(w.statuses) s ON s->>'key' = r.status
       WHERE ${where.join(' AND ')}
       ORDER BY t.assigned_at DESC
       LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params
    );

    res.json({
      tasks: rows.map((r) => ({
        id: r.id,
        requestId: r.request_id,
        serviceTypeId: r.service_type_id,
        serviceTypeName: r.service_type_name,
        status: { key: r.status, label: r.status_label, category: r.category },
        priority: r.priority,
        assignedAt: r.assigned_at,
        requestCreatedAt: r.request_created_at,
      })),
      page,
      pageSize,
      total: rows.length ? rows[0].total : 0,
    });
  } catch (err) {
    next(err);
  }
});

// GET /tasks/{id} — Task Details' single call.
router.get('/:id', async (req, res, next) => {
  try {
    const t = await loadOwnTask(Number(req.params.id), req.user.id);

    const [form, attachments] = await Promise.all([
      pool.query(
        `SELECT field_schema FROM form_definition
         WHERE service_type_id = $1 AND form_type = 'request'`,
        [t.service_type_id]
      ),
      pool.query(
        `SELECT id, original_filename, mime_type, size_bytes, uploaded_at
         FROM file_attachment
         WHERE request_id = $1 OR task_id = $2
         ORDER BY uploaded_at`,
        [t.request_id, t.id]
      ),
    ]);

    res.json({
      task: {
        id: t.id,
        requestId: t.request_id,
        serviceTypeId: t.service_type_id,
        serviceTypeName: t.service_type_name,
        status: statusOf(t.statuses, t.status),
        priority: t.priority,
        assignedAt: t.assigned_at,
        completionFormResponse: t.completion_form_response,
        request: {
          createdAt: t.request_created_at,
          formResponse: stripHiddenFields(form.rows[0].field_schema, t.form_response),
          requester: { name: t.requester_name, phone: t.requester_phone },
        },
        attachments: attachments.rows.map((a) => ({
          id: a.id,
          originalFilename: a.original_filename,
          mimeType: a.mime_type,
          sizeBytes: a.size_bytes,
          uploadedAt: a.uploaded_at,
        })),
      },
    });
  } catch (err) {
    next(err);
  }
});

// GET /tasks/{id}/valid-transitions — what the employee can do right now.
router.get('/:id/valid-transitions', async (req, res, next) => {
  try {
    const t = await loadOwnTask(Number(req.params.id), req.user.id);
    res.json({
      transitions: validTransitions(t.statuses, t.transitions, t.status, 'employee').map((tr) => ({
        to: tr.to,
        toLabel: statusOf(t.statuses, tr.to).label,
        toCategory: statusOf(t.statuses, tr.to).category,
        action: tr.action ?? null,
        requiresNote: !!tr.requires_note,
        requiresCompletionForm: !!tr.requires_completion_form,
      })),
    });
  } catch (err) {
    next(err);
  }
});

// The three mutating routes share one shape: resolve own task (404), then
// hand the transition to the engine, which re-locks and re-validates.
async function runTransition(req, res, next, { to = null, action = null }) {
  try {
    const t = await loadOwnTask(Number(req.params.id), req.user.id);
    const note = (req.body || {}).note ?? null;
    const result = await executeTransition({ requestId: t.request_id, user: req.user, to, action, note });
    res.json({ task: { id: t.id, requestId: t.request_id, status: result.status } });
  } catch (err) {
    next(err);
  }
}

router.patch('/:id/accept', (req, res, next) => runTransition(req, res, next, { action: 'accept' }));
router.patch('/:id/reject', (req, res, next) => runTransition(req, res, next, { action: 'reject' }));

router.patch('/:id/status', (req, res, next) => {
  const { to } = req.body || {};
  if (typeof to !== 'string' || !to) {
    return res.status(422).json({ errors: { to: 'A target status is required' } });
  }
  return runTransition(req, res, next, { to });
});

// POST /tasks/{id}/complete — executes the workflow's complete-action
// transition after validating completionFormResponse against the completion
// FORM_DEFINITION (422 per-field, Section 8). The transition is pre-checked
// so a locked/wrong-status task answers 409 before form errors (must-pass
// #6); the engine re-validates under the row lock, and the response is
// stored on the task inside the same transaction via beforeCommit.
router.post('/:id/complete', async (req, res, next) => {
  try {
    const t = await loadOwnTask(Number(req.params.id), req.user.id);
    const can = validTransitions(t.statuses, t.transitions, t.status, 'employee').some(
      (tr) => tr.action === 'complete'
    );
    if (!can) {
      return res.status(409).json({ error: 'This transition is not valid from the current status' });
    }

    const { rows } = await pool.query(
      `SELECT field_schema FROM form_definition
       WHERE service_type_id = $1 AND form_type = 'completion'`,
      [t.service_type_id]
    );
    const response = (req.body || {}).completionFormResponse;
    const errors = await validateFormResponse(rows[0].field_schema, response, {
      db: pool,
      userId: req.user.id,
    });
    if (Object.keys(errors).length) return res.status(422).json({ errors });

    const note = (req.body || {}).note ?? null;
    const result = await executeTransition({
      requestId: t.request_id,
      user: req.user,
      action: 'complete',
      note,
      completionValidated: true,
      beforeCommit: (tx, ctx) =>
        tx.query('UPDATE task SET completion_form_response = $1 WHERE id = $2', [
          JSON.stringify(response),
          ctx.task.id,
        ]),
    });
    res.json({ task: { id: t.id, requestId: t.request_id, status: result.status } });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
