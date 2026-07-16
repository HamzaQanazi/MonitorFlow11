// Tasks (CLAUDE.md Section 7): the employee's read surface. Employees never
// call GET /requests/{id} — GET /tasks/{id} embeds the limited request data
// they are allowed to see (requester name + phone, never email; form_response
// stripped of visible_to_employee:false fields).
//
// Phase 4 (§10): the employee's *actions* now go through the one generic
// POST /requests/{id}/transitions (the assignee party); the old
// /tasks/{id}/{accept,reject,complete,status,valid-transitions} endpoints are
// gone. This router is read-only — nothing here writes a status.
const express = require('express');
const pool = require('../db');
const { requireAuth, requireRole } = require('../middleware/auth');
const { WorkflowError, statusOf } = require('../lib/workflowEngine');

const router = express.Router();
router.use(requireAuth);
// Oversight reads progress via REQUEST.status — there is no oversight-facing
// task endpoint (Section 5), so the whole router is employee-only.
router.use(requireRole('employee'));

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
            w.statuses,
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
    if (q.serviceTypeId !== undefined) add('r.service_type_id = ?', Number(q.serviceTypeId));
    if (q.priority !== undefined) add('r.priority = ?', q.priority);
    if (q.dateFrom !== undefined) add('t.assigned_at >= ?::date', q.dateFrom);
    if (q.dateTo !== undefined) add("t.assigned_at < ?::date + INTERVAL '1 day'", q.dateTo);
    // st.name is bilingual JSONB (Phase 3) — search both language values.
    if (q.q) add("(st.name->>'en' ILIKE ? OR st.name->>'ar' ILIKE ?)", `%${q.q}%`);

    params.push(pageSize, (page - 1) * pageSize);
    const { rows } = await pool.query(
      `SELECT t.id, t.request_id, t.assigned_at,
              r.service_type_id, st.name AS service_type_name,
              r.status, s->'label' AS status_label, (s->>'is_terminal')::bool AS is_terminal,
              EXISTS (
                SELECT 1 FROM jsonb_array_elements(w.transitions) tx
                WHERE tx->>'from' = r.status AND tx->>'actor' = 'assignee'
                  AND (tx->>'notify_oversight')::bool
              ) AS needs_response,
              r.priority, r.created_at AS request_created_at,
              r.location_lat, r.location_lng, fd.field_schema,
              COUNT(*) OVER()::int AS total
       FROM task t
       JOIN request r ON r.id = t.request_id
       JOIN service_type st ON st.id = r.service_type_id
       JOIN workflow_definition w ON w.service_type_id = r.service_type_id
       JOIN form_definition fd ON fd.service_type_id = r.service_type_id AND fd.form_type = 'request'
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
        status: { key: r.status, label: r.status_label, isTerminal: r.is_terminal },
        // The accept/reject decision window: an assignee reject (the
        // notify_oversight transition) is still available from this status.
        needsResponse: r.needs_response,
        priority: r.priority,
        assignedAt: r.assigned_at,
        requestCreatedAt: r.request_created_at,
        // v5 map amendment: the list feed must not leak what
        // stripHiddenFields hides in detail — emit coords only when the
        // form's location field (max one) is employee-visible.
        location:
          r.location_lat !== null &&
          r.field_schema.some((f) => f.type === 'location' && f.visible_to_employee !== false)
            ? { lat: r.location_lat, lng: r.location_lng }
            : null,
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

module.exports = router;
