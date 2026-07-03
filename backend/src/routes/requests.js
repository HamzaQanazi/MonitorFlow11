// Requests: submit + list + detail (CLAUDE.md Section 7). Creation is not a
// transition — the request starts at the workflow's is_initial status and the
// Week 4 workflow engine owns every write to REQUEST.status after this.
// Status keys never appear here; labels/categories come from the stored
// workflow definition (Section 9).
const express = require('express');
const pool = require('../db');
const { requireAuth } = require('../middleware/auth');
const { validateFormResponse } = require('../lib/validateFormResponse');

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

    const [history, comments, attachments] = await Promise.all([
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

module.exports = router;
