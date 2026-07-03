// Requests: submit + list + detail (CLAUDE.md Section 7). Creation is not a
// transition — the request starts at the workflow's is_initial status and the
// Week 4 workflow engine owns every write to REQUEST.status after this.
// Status keys never appear here; labels/categories come from the stored
// workflow definition (Section 9).
const express = require('express');
const pool = require('../db');
const { requireAuth, requireRole } = require('../middleware/auth');
const { validateFormResponse } = require('../lib/validateFormResponse');
const { categoryOf, executeTransition } = require('../lib/workflowEngine');

const router = express.Router();
router.use(requireAuth);

const CATEGORIES = ['new', 'triage', 'in_progress', 'done', 'closed', 'terminated'];
const PRIORITIES = ['low', 'medium', 'high'];
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function statusOf(workflowStatuses, key) {
  const s = workflowStatuses.find((st) => st.key === key);
  return { key, label: s ? s.label : key, category: s ? s.category : null };
}

function listItem(row) {
  return {
    id: row.id,
    serviceTypeId: row.service_type_id,
    serviceTypeName: row.service_type_name,
    status: { key: row.status, label: row.status_label, category: row.category },
    priority: row.priority,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    requester: { id: row.requester_id, name: row.requester_name },
  };
}

// POST /requests — submit (user role only, Section 6)
router.post('/', async (req, res, next) => {
  try {
    if (req.user.role !== 'user') return res.status(403).json({ error: 'Forbidden' });

    const { serviceTypeId, formResponse } = req.body || {};
    if (!Number.isInteger(serviceTypeId)) {
      return res.status(422).json({ errors: { serviceTypeId: 'A service type is required' } });
    }

    const { rows } = await pool.query(
      `SELECT st.id, st.default_priority, fd.field_schema, w.statuses
       FROM service_type st
       JOIN form_definition fd ON fd.service_type_id = st.id AND fd.form_type = 'request'
       JOIN workflow_definition w ON w.service_type_id = st.id
       WHERE st.id = $1 AND st.enabled`,
      [serviceTypeId]
    );
    if (!rows.length) return res.status(404).json({ error: 'Not found' });
    const service = rows[0];

    const errors = await validateFormResponse(service.field_schema, formResponse, {
      db: pool,
      userId: req.user.id,
    });
    if (Object.keys(errors).length) return res.status(422).json({ errors });

    const initial = service.statuses.find((s) => s.is_initial);

    const client = await pool.connect();
    let created;
    try {
      await client.query('BEGIN');
      ({ rows: [created] } = await client.query(
        `INSERT INTO request (user_id, service_type_id, form_response, status, priority)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING id, service_type_id, status, priority, created_at, updated_at`,
        [req.user.id, service.id, JSON.stringify(formResponse), initial.key, service.default_priority]
      ));
      await client.query(
        `INSERT INTO request_status_history (request_id, status, changed_by, changed_at)
         VALUES ($1, $2, $3, $4)`,
        [created.id, initial.key, req.user.id, created.created_at]
      );
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }

    res.status(201).json({
      request: {
        id: created.id,
        serviceTypeId: created.service_type_id,
        status: statusOf(service.statuses, created.status),
        priority: created.priority,
        formResponse,
        createdAt: created.created_at,
        updatedAt: created.updated_at,
        requester: { id: req.user.id, name: req.user.name },
      },
    });
  } catch (err) {
    next(err);
  }
});

// GET /requests — user: own only; monitor: all (Section 6). Standard list
// params (Section 7); irrelevant/unknown params are ignored, invalid values
// for known params are 400.
router.get('/', async (req, res, next) => {
  try {
    if (req.user.role === 'employee') return res.status(403).json({ error: 'Forbidden' });

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

    const where = [];
    const params = [];
    const add = (sql, value) => {
      params.push(value);
      where.push(sql.replaceAll('?', `$${params.length}`));
    };

    // A user only ever sees their own requests, whatever the params say.
    if (req.user.role === 'user' || q.userId === 'me') add('r.user_id = ?', req.user.id);
    if (q.status !== undefined) add('r.status = ?', q.status);
    if (q.category !== undefined) add("s->>'category' = ?", q.category);
    if (q.serviceTypeId !== undefined) add('r.service_type_id = ?', Number(q.serviceTypeId));
    if (q.priority !== undefined) add('r.priority = ?', q.priority);
    if (q.dateFrom !== undefined) add('r.created_at >= ?::date', q.dateFrom);
    if (q.dateTo !== undefined) add("r.created_at < ?::date + INTERVAL '1 day'", q.dateTo);
    if (q.q) add('(u.name ILIKE ? OR st.name ILIKE ?)', `%${q.q}%`);

    params.push(pageSize, (page - 1) * pageSize);
    const { rows } = await pool.query(
      `SELECT r.id, r.service_type_id, st.name AS service_type_name,
              r.status, s->>'label' AS status_label, s->>'category' AS category,
              r.priority, r.created_at, r.updated_at,
              u.id AS requester_id, u.name AS requester_name,
              COUNT(*) OVER()::int AS total
       FROM request r
       JOIN service_type st ON st.id = r.service_type_id
       JOIN users u ON u.id = r.user_id
       JOIN workflow_definition w ON w.service_type_id = r.service_type_id
       JOIN LATERAL jsonb_array_elements(w.statuses) s ON s->>'key' = r.status
       ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
       ORDER BY r.created_at DESC
       LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params
    );

    res.json({
      requests: rows.map(listItem),
      page,
      pageSize,
      total: rows.length ? rows[0].total : 0,
    });
  } catch (err) {
    next(err);
  }
});

// GET /requests/{id} — user own (404 otherwise, Section 6's 404-over-403
// rule) / monitor any; employees use GET /tasks/{id}, never this. Embeds
// history, comments, and attachment metadata: the Timeline page needs
// exactly one call (Section 7).
router.get('/:id', async (req, res, next) => {
  try {
    if (req.user.role === 'employee') return res.status(403).json({ error: 'Forbidden' });
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) return res.status(404).json({ error: 'Not found' });

    const { rows } = await pool.query(
      `SELECT r.*, st.name AS service_type_name, w.statuses AS workflow_statuses,
              u.id AS requester_id, u.name AS requester_name, u.email AS requester_email,
              u.phone AS requester_phone
       FROM request r
       JOIN service_type st ON st.id = r.service_type_id
       JOIN users u ON u.id = r.user_id
       JOIN workflow_definition w ON w.service_type_id = r.service_type_id
       WHERE r.id = $1`,
      [id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Not found' });
    const r = rows[0];
    if (req.user.role === 'user' && r.user_id !== req.user.id) {
      return res.status(404).json({ error: 'Not found' });
    }

    const [history, comments, attachments, task] = await Promise.all([
      pool.query(
        `SELECT h.status, h.changed_at, h.note, u.id AS by_id, u.name AS by_name
         FROM request_status_history h
         JOIN users u ON u.id = h.changed_by
         WHERE h.request_id = $1
         ORDER BY h.changed_at, h.id`,
        [id]
      ),
      pool.query(
        `SELECT c.id, c.body, c.created_at, u.id AS by_id, u.name AS by_name
         FROM request_comment c
         JOIN users u ON u.id = c.user_id
         WHERE c.request_id = $1
         ORDER BY c.created_at, c.id`,
        [id]
      ),
      pool.query(
        `SELECT id, original_filename, mime_type, size_bytes, uploaded_at
         FROM file_attachment
         WHERE request_id = $1
         ORDER BY uploaded_at`,
        [id]
      ),
      // Current assignment, so the Monitor detail pane can render and change
      // it without a second endpoint (progress still reads via status).
      pool.query(
        `SELECT t.id, t.employee_id, t.assigned_at, u.name AS employee_name
         FROM task t
         JOIN users u ON u.id = t.employee_id
         WHERE t.request_id = $1`,
        [id]
      ),
    ]);

    res.json({
      request: {
        id: r.id,
        serviceTypeId: r.service_type_id,
        serviceTypeName: r.service_type_name,
        status: statusOf(r.workflow_statuses, r.status),
        priority: r.priority,
        formResponse: r.form_response,
        createdAt: r.created_at,
        updatedAt: r.updated_at,
        requester: {
          id: r.requester_id,
          name: r.requester_name,
          email: r.requester_email,
          phone: r.requester_phone,
        },
        task: task.rows[0]
          ? {
              id: task.rows[0].id,
              employeeId: task.rows[0].employee_id,
              employeeName: task.rows[0].employee_name,
              assignedAt: task.rows[0].assigned_at,
            }
          : null,
        statusHistory: history.rows.map((h) => ({
          status: statusOf(r.workflow_statuses, h.status),
          changedBy: { id: h.by_id, name: h.by_name },
          changedAt: h.changed_at,
          note: h.note,
        })),
        comments: comments.rows.map((c) => ({
          id: c.id,
          body: c.body,
          createdAt: c.created_at,
          author: { id: c.by_id, name: c.by_name },
        })),
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

// Shared by the comment routes: Section 6 comment cells — user own (404
// otherwise), monitor any, employee never. Returns the request row or null
// after having written the error response.
async function loadCommentableRequest(req, res) {
  if (req.user.role === 'employee') {
    res.status(403).json({ error: 'Forbidden' });
    return null;
  }
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) {
    res.status(404).json({ error: 'Not found' });
    return null;
  }
  const { rows } = await pool.query(
    `SELECT r.id, r.user_id, st.name AS service_name
     FROM request r JOIN service_type st ON st.id = r.service_type_id
     WHERE r.id = $1`,
    [id]
  );
  if (!rows.length || (req.user.role === 'user' && rows[0].user_id !== req.user.id)) {
    res.status(404).json({ error: 'Not found' });
    return null;
  }
  return rows[0];
}

// POST /requests/{id}/comments — notifies the other party (Section 7
// trigger table: owner ↔ monitors).
router.post('/:id/comments', async (req, res, next) => {
  try {
    const request = await loadCommentableRequest(req, res);
    if (!request) return;
    const { body } = req.body || {};
    if (typeof body !== 'string' || !body.trim()) {
      return res.status(422).json({ errors: { body: 'A comment body is required' } });
    }

    const client = await pool.connect();
    let created;
    try {
      await client.query('BEGIN');
      ({ rows: [created] } = await client.query(
        `INSERT INTO request_comment (request_id, user_id, body)
         VALUES ($1, $2, $3) RETURNING id, created_at`,
        [request.id, req.user.id, body.trim()]
      ));
      const message = `${req.user.name} commented on request #${request.id} (${request.service_name}).`;
      if (req.user.role === 'monitor') {
        await client.query(
          `INSERT INTO notification (user_id, request_id, type, message)
           VALUES ($1, $2, 'comment', $3)`,
          [request.user_id, request.id, message]
        );
      } else {
        await client.query(
          `INSERT INTO notification (user_id, request_id, type, message)
           SELECT id, $1, 'comment', $2 FROM users WHERE role = 'monitor' AND is_active`,
          [request.id, message]
        );
      }
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }

    res.status(201).json({
      comment: {
        id: created.id,
        body: body.trim(),
        createdAt: created.created_at,
        author: { id: req.user.id, name: req.user.name },
      },
    });
  } catch (err) {
    next(err);
  }
});

// GET /requests/{id}/comments
router.get('/:id/comments', async (req, res, next) => {
  try {
    const request = await loadCommentableRequest(req, res);
    if (!request) return;
    const { rows } = await pool.query(
      `SELECT c.id, c.body, c.created_at, u.id AS by_id, u.name AS by_name
       FROM request_comment c
       JOIN users u ON u.id = c.user_id
       WHERE c.request_id = $1
       ORDER BY c.created_at, c.id`,
      [request.id]
    );
    res.json({
      comments: rows.map((c) => ({
        id: c.id,
        body: c.body,
        createdAt: c.created_at,
        author: { id: c.by_id, name: c.by_name },
      })),
    });
  } catch (err) {
    next(err);
  }
});

// PATCH /requests/{id}/priority — monitor only. Not a status transition, but
// it writes a history row with a descriptive note (Section 5) under the
// request row lock so the timeline stays a complete, ordered audit trail.
router.patch('/:id/priority', requireRole('monitor'), async (req, res, next) => {
  const client = await pool.connect();
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) return res.status(404).json({ error: 'Not found' });
    const { priority } = req.body || {};
    if (!PRIORITIES.includes(priority)) {
      return res.status(422).json({ errors: { priority: 'Priority must be low, medium, or high' } });
    }

    await client.query('BEGIN');
    const { rows } = await client.query(
      'SELECT id, status, priority FROM request WHERE id = $1 FOR UPDATE',
      [id]
    );
    if (!rows.length) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Not found' });
    }
    const request = rows[0];

    if (request.priority !== priority) {
      await client.query('UPDATE request SET priority = $1, updated_at = now() WHERE id = $2', [
        priority,
        id,
      ]);
      await client.query(
        `INSERT INTO request_status_history (request_id, status, changed_by, note)
         VALUES ($1, $2, $3, $4)`,
        [id, request.status, req.user.id, `Priority changed from ${request.priority} to ${priority}`]
      );
    }
    await client.query('COMMIT');

    res.json({ request: { id, priority } });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    next(err);
  } finally {
    client.release();
  }
});

// PATCH /requests/{id}/assign — monitor only (Section 7). No status key is
// named here: the "ready to work" status a workflow assigns into is derived
// from the data as the from-status of its accept-action transition. Two
// paths, both race-safe under the request row lock:
//  - a monitor transition from the current status into that target exists →
//    execute it via the engine, upserting the TASK row in the same tx
//    (first assignment, and re-assignment after an employee reject);
//  - otherwise, if a task already exists and the request isn't finished →
//    reassign in place: employee_id + assigned_at only, no status write,
//    history note per Section 5.
router.patch('/:id/assign', requireRole('monitor'), async (req, res, next) => {
  const client = await pool.connect();
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) return res.status(404).json({ error: 'Not found' });
    const { employeeId } = req.body || {};
    if (!Number.isInteger(employeeId)) {
      return res.status(422).json({ errors: { employeeId: 'An employee is required' } });
    }

    await client.query('BEGIN');
    const { rows } = await client.query(
      `SELECT r.id, r.status, r.service_type_id, st.department_id, st.name AS service_name,
              w.statuses, w.transitions
       FROM request r
       JOIN service_type st ON st.id = r.service_type_id
       JOIN workflow_definition w ON w.service_type_id = r.service_type_id
       WHERE r.id = $1
       FOR UPDATE OF r`,
      [id]
    );
    if (!rows.length) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Not found' });
    }
    const request = rows[0];

    // Department rule (Section 5): active employees of the service's
    // department only — 422 otherwise.
    const { rows: empRows } = await client.query(
      `SELECT id, name, department_id, is_active FROM users WHERE id = $1 AND role = 'employee'`,
      [employeeId]
    );
    const employee = empRows[0];
    if (!employee || !employee.is_active || employee.department_id !== request.department_id) {
      await client.query('ROLLBACK');
      return res.status(422).json({
        errors: { employeeId: 'Must be an active employee of the service’s department' },
      });
    }

    const { rows: taskRows } = await client.query(
      'SELECT id, employee_id FROM task WHERE request_id = $1',
      [request.id]
    );
    const task = taskRows[0] || null;

    const acceptTransition = request.transitions.find((t) => t.action === 'accept');
    const assignTarget = acceptTransition ? acceptTransition.from : null;
    const assignTransition = request.transitions.find(
      (t) => t.from === request.status && t.to === assignTarget && t.allowed_role === 'monitor'
    );

    if (assignTransition) {
      // Engine path needs its own transaction — release this lock first; the
      // engine re-locks and re-validates, so a race degrades to its 409.
      await client.query('ROLLBACK');
      const note = task
        ? `Reassigned to ${employee.name} after rejection`
        : `Assigned to ${employee.name}`;
      const result = await executeTransition({
        requestId: request.id,
        user: req.user,
        to: assignTarget,
        note,
        beforeCommit: async (tx, ctx) => {
          const upsert = ctx.task
            ? await tx.query(
                'UPDATE task SET employee_id = $1, assigned_at = now() WHERE id = $2 RETURNING id, assigned_at',
                [employee.id, ctx.task.id]
              )
            : await tx.query(
                'INSERT INTO task (request_id, employee_id, status) VALUES ($1, $2, $3) RETURNING id, assigned_at',
                [ctx.request.id, employee.id, ctx.transition.to]
              );
          await tx.query(
            'INSERT INTO notification (user_id, request_id, type, message) VALUES ($1, $2, $3, $4)',
            [
              employee.id,
              ctx.request.id,
              'assigned',
              `You have been assigned request #${ctx.request.id} (${ctx.request.service_name}).`,
            ]
          );
          return upsert.rows[0];
        },
      });
      return res.json({
        request: { id: request.id, status: result.status },
        task: {
          id: result.extra.id,
          employeeId: employee.id,
          employeeName: employee.name,
          assignedAt: result.extra.assigned_at,
        },
      });
    }

    // No transition into the assign target from here: only an in-place
    // reassignment of an existing, still-open task is possible.
    const category = categoryOf(request.statuses, request.status);
    if (!task || category === 'terminated' || category === 'closed') {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: 'This request cannot be assigned in its current state' });
    }
    if (task.employee_id === employee.id) {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: 'This task is already assigned to that employee' });
    }

    const { rows: prevRows } = await client.query('SELECT name FROM users WHERE id = $1', [
      task.employee_id,
    ]);
    const { rows: updated } = await client.query(
      'UPDATE task SET employee_id = $1, assigned_at = now() WHERE id = $2 RETURNING id, assigned_at',
      [employee.id, task.id]
    );
    // Reassignment writes a history row with a descriptive note (Section 5);
    // the status column repeats the unchanged current status.
    await client.query(
      `INSERT INTO request_status_history (request_id, status, changed_by, note)
       VALUES ($1, $2, $3, $4)`,
      [request.id, request.status, req.user.id, `Reassigned from ${prevRows[0].name} to ${employee.name}`]
    );
    await client.query(
      'INSERT INTO notification (user_id, request_id, type, message) VALUES ($1, $2, $3, $4)',
      [
        employee.id,
        request.id,
        'assigned',
        `You have been assigned request #${request.id} (${request.service_name}).`,
      ]
    );
    await client.query('COMMIT');

    res.json({
      request: {
        id: request.id,
        status: {
          key: request.status,
          label: request.statuses.find((s) => s.key === request.status)?.label ?? request.status,
          category,
        },
      },
      task: {
        id: updated[0].id,
        employeeId: employee.id,
        employeeName: employee.name,
        assignedAt: updated[0].assigned_at,
      },
    });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    next(err);
  } finally {
    client.release();
  }
});

module.exports = router;
