// Requests: submit + list + detail (CLAUDE.md Section 7). Creation is not a
// transition — the request starts at the workflow's is_initial status and the
// Week 4 workflow engine owns every write to REQUEST.status after this.
// Status keys never appear here; labels/categories come from the stored
// workflow definition (Section 9).
const express = require('express');
const pool = require('../db');
const { requireAuth, requireRole, requireCapability } = require('../middleware/auth');
const { validateFormResponse } = require('../lib/validateFormResponse');
const {
  statusOf,
  isTerminal,
  validTransitions,
  executeTransition,
  WorkflowError,
} = require('../lib/workflowEngine');
const { buildRequestFilter, PRIORITIES } = require('../lib/requestQuery');
const { isOversight } = require('../lib/capabilities');
const { subtreeIds, ownerInScope } = require('../lib/scope');
const { pick } = require('../lib/i18nLabel');
const { fireWebhook } = require('../lib/webhooks');
const { logAudit } = require('../lib/audit');

const router = express.Router();
router.use(requireAuth);
// Admin is configuration-and-accounts only — the whole requests surface
// belongs to the operational kinds. Oversight authority now comes from the
// employee's capabilities, not a monitor role; admins are excluded here so the
// per-route "field-employee → 403, user → own" checks can't let them fall
// through to oversight visibility (must-pass #20).
router.use(requireRole('user', 'employee'));

function listItem(row) {
  return {
    id: row.id,
    serviceTypeId: row.service_type_id,
    serviceTypeName: row.service_type_name,
    status: { key: row.status, label: row.status_label, isTerminal: row.is_terminal },
    priority: row.priority,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    requester: { id: row.requester_id, name: row.requester_name },
    // v5 map amendment: the web map's data — pin position + tooltip employee.
    location: row.location_lat === null ? null : { lat: row.location_lat, lng: row.location_lng },
    assignedEmployee: row.assigned_employee_id
      ? { id: row.assigned_employee_id, name: row.assigned_employee_name }
      : null,
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
      `SELECT st.id, st.key, st.default_priority, st.accepts_external_users,
              fd.field_schema, w.statuses
       FROM service_type st
       JOIN form_definition fd ON fd.service_type_id = st.id AND fd.form_type = 'request'
       JOIN workflow_definition w ON w.service_type_id = st.id
       WHERE st.id = $1 AND st.enabled`,
      [serviceTypeId]
    );
    if (!rows.length) return res.status(404).json({ error: 'Not found' });
    const service = rows[0];

    // Phase 7: a service that doesn't accept external users is not submittable
    // by self-registered `user` accounts (it's also hidden from their catalogue
    // — GET /services). Enforced server-side, not just in the UI.
    if (!service.accepts_external_users) return res.status(403).json({ error: 'Forbidden' });

    const errors = await validateFormResponse(service.field_schema, formResponse, {
      db: pool,
      userId: req.user.id,
    });
    if (Object.keys(errors).length) return res.status(422).json({ errors });

    const initial = service.statuses.find((s) => s.is_initial);

    // v5 map amendment: denormalize the location field (max one per form)
    // into request columns so list queries never dig into the JSONB.
    const locationField = service.field_schema.find((f) => f.type === 'location');
    const location =
      locationField && formResponse[locationField.id] && typeof formResponse[locationField.id] === 'object'
        ? formResponse[locationField.id]
        : null;

    const client = await pool.connect();
    let created;
    try {
      await client.query('BEGIN');
      ({ rows: [created] } = await client.query(
        // Phase 6: the pin is a PostGIS geography point (lng first — PostGIS
        // is x,y). NULLIF keeps a null location when the form has no pin.
        `INSERT INTO request (user_id, service_type_id, form_response, status, priority, location)
         VALUES ($1, $2, $3, $4, $5,
                 CASE WHEN $6::float8 IS NULL THEN NULL
                      ELSE ST_SetSRID(ST_MakePoint($7::float8, $6::float8), 4326)::geography END)
         RETURNING id, service_type_id, status, priority, created_at, updated_at`,
        [
          req.user.id,
          service.id,
          JSON.stringify(formResponse),
          initial.key,
          service.default_priority,
          location ? location.lat : null,
          location ? location.lng : null,
        ]
      ));
      await client.query(
        `INSERT INTO request_status_history (request_id, status, changed_by, changed_at)
         VALUES ($1, $2, $3, $4)`,
        [created.id, initial.key, req.user.id, created.created_at]
      );
      // Link pending photo uploads (Section 7 two-step). The WHERE re-checks
      // ownership and unlinked state atomically, so an id belonging to (or
      // already claimed by) another request can't be smuggled in.
      for (const field of service.field_schema) {
        if (field.type !== 'photo' || formResponse[field.id] == null) continue;
        const linked = await client.query(
          `UPDATE file_attachment SET request_id = $1
           WHERE id = $2 AND uploaded_by = $3
             AND request_id IS NULL AND task_id IS NULL`,
          [created.id, formResponse[field.id], req.user.id]
        );
        if (linked.rowCount === 0) {
          await client.query('ROLLBACK');
          return res
            .status(422)
            .json({ errors: { [field.id]: `${pick(field.label)} must be an uploaded attachment id` } });
        }
      }
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }

    // Phase 7: request_created webhook, after commit, fire-and-forget.
    fireWebhook('request_created', {
      request_id: created.id,
      service_key: service.key,
      status: created.status,
    });

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
    // Field employees use GET /tasks, not this list; only requesters (own) and
    // oversight employees (subtree) read requests here.
    if (req.user.role === 'employee' && !isOversight(req.user)) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    const scope = isOversight(req.user) ? await subtreeIds(req.user.id) : null;
    const filter = buildRequestFilter(req.query, req.user, scope);
    if (filter.error) return res.status(400).json({ error: filter.error });
    const { where, params, page, pageSize } = filter;

    params.push(pageSize, (page - 1) * pageSize);
    const { rows } = await pool.query(
      `SELECT r.id, r.service_type_id, st.name AS service_type_name,
              r.status, s->'label' AS status_label, (s->>'is_terminal')::bool AS is_terminal,
              r.priority, r.created_at, r.updated_at,
              u.id AS requester_id, u.name AS requester_name,
              ST_Y(r.location::geometry) AS location_lat, ST_X(r.location::geometry) AS location_lng,
              tk.employee_id AS assigned_employee_id, emp.name AS assigned_employee_name,
              COUNT(*) OVER()::int AS total
       FROM request r
       JOIN service_type st ON st.id = r.service_type_id
       JOIN users u ON u.id = r.user_id
       JOIN workflow_definition w ON w.service_type_id = r.service_type_id
       JOIN LATERAL jsonb_array_elements(w.statuses) s ON s->>'key' = r.status
       LEFT JOIN task tk ON tk.request_id = r.id
       LEFT JOIN users emp ON emp.id = tk.employee_id
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
    if (req.user.role === 'employee' && !isOversight(req.user)) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) return res.status(404).json({ error: 'Not found' });

    const { rows } = await pool.query(
      `SELECT r.*, st.name AS service_type_name, st.owner_id AS service_owner_id,
              w.statuses AS workflow_statuses,
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
    // Gate 2: an oversight employee sees a request only if its service owner is
    // in their subtree (404-over-403).
    if (isOversight(req.user) && !(await ownerInScope(req.user.id, r.service_owner_id))) {
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
      // Task-linked files (completion photos) belong to this request too —
      // the attachment row carries task_id, not request_id (the XOR rule).
      pool.query(
        `SELECT fa.id, fa.original_filename, fa.mime_type, fa.size_bytes, fa.uploaded_at,
                fa.task_id
         FROM file_attachment fa
         LEFT JOIN task t ON t.id = fa.task_id
         WHERE fa.request_id = $1 OR t.request_id = $1
         ORDER BY fa.uploaded_at`,
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
          // Request-linked photos arrive with the request (before the
          // service); task-linked ones come from the completion (after).
          source: a.task_id === null ? 'request' : 'task',
          taskId: a.task_id,
        })),
      },
    });
  } catch (err) {
    next(err);
  }
});

// GET /requests/{id}/transitions — the ONE generic call (Phase 4 §10): the
// legal next actions from the current status that this caller may fire, both
// gates already applied. The requester sees their own actions (own request,
// 404 otherwise); the assigned employee sees theirs (own task, 404 otherwise);
// oversight employees act through the dedicated /assign, /priority, /status
// endpoints, so they get an empty list here. Clients render exactly these
// buttons and nothing else — the accept/reject/complete/confirm/dispute
// endpoints are gone.
async function loadTransitionContext(req, res) {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) {
    res.status(404).json({ error: 'Not found' });
    return null;
  }
  const { rows } = await pool.query(
    `SELECT r.id, r.user_id, r.status, r.service_type_id, w.statuses, w.transitions
     FROM request r
     JOIN workflow_definition w ON w.service_type_id = r.service_type_id
     WHERE r.id = $1`,
    [id]
  );
  if (!rows.length) {
    res.status(404).json({ error: 'Not found' });
    return null;
  }
  const request = rows[0];

  // Party + ownership (404-over-403). Oversight employees have no actor
  // transitions here — they use the dedicated oversight endpoints.
  if (req.user.role === 'user') {
    if (request.user_id !== req.user.id) {
      res.status(404).json({ error: 'Not found' });
      return null;
    }
    return { id, request, party: 'requester' };
  }
  if (isOversight(req.user)) return { id, request, party: null };
  const { rows: taskRows } = await pool.query(
    'SELECT employee_id FROM task WHERE request_id = $1',
    [id]
  );
  if (!taskRows.length || taskRows[0].employee_id !== req.user.id) {
    res.status(404).json({ error: 'Not found' });
    return null;
  }
  return { id, request, party: 'assignee' };
}

router.get('/:id/transitions', async (req, res, next) => {
  try {
    const ctx = await loadTransitionContext(req, res);
    if (!ctx) return;
    const { request, party } = ctx;
    let options = party
      ? validTransitions(request.statuses, request.transitions, request.status, party)
      : [];
    // The requester's cancel (terminal move out of the initial status)
    // vanishes once a task exists — the display mirror of the engine's
    // requester-cancel guard. Confirm (terminal, but later in the flow)
    // stays.
    const cancelLike = (t) =>
      isTerminal(request.statuses, t.to) &&
      request.statuses.some((s) => s.key === t.from && s.is_initial);
    if (party === 'requester' && options.some(cancelLike)) {
      const { rows: taskRows } = await pool.query('SELECT 1 FROM task WHERE request_id = $1', [
        ctx.id,
      ]);
      if (taskRows.length) {
        options = options.filter((t) => !cancelLike(t));
      }
    }
    res.json({
      transitions: options.map((t) => ({
        key: t.key,
        label: t.label,
        to: t.to,
        toLabel: statusOf(request.statuses, t.to).label,
        toTerminal: isTerminal(request.statuses, t.to),
        requiresNote: !!t.requires_note,
        requiredFormKey: t.required_form_key ?? null,
      })),
    });
  } catch (err) {
    next(err);
  }
});

// POST /requests/{id}/transitions — fire one transition. The engine re-locks
// and re-validates everything (legal-from-status → party → note → form →
// expected_status concurrency); this handler only pre-validates the required
// form so a 422's per-field errors reach the client. A transition carrying a
// required_form_key stores its response on the task inside the same
// transaction (the completion form, §7).
router.post('/:id/transitions', async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) return res.status(404).json({ error: 'Not found' });
    const body = req.body || {};
    const transitionKey = body.transition_key;
    if (typeof transitionKey !== 'string' || !transitionKey) {
      return res.status(422).json({ errors: { transition_key: 'A transition key is required' } });
    }

    // Peek at the transition (unlocked) to see whether a form is required and
    // validate it before the engine runs — the engine re-checks under the lock.
    const { rows } = await pool.query(
      `SELECT r.status, r.service_type_id, w.transitions
       FROM request r JOIN workflow_definition w ON w.service_type_id = r.service_type_id
       WHERE r.id = $1`,
      [id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Not found' });
    const pending = rows[0].transitions.find(
      (t) => t.key === transitionKey && t.from === rows[0].status
    );

    let formValidated = false;
    let beforeCommit = null;
    if (pending && pending.required_form_key) {
      const { rows: fd } = await pool.query(
        `SELECT field_schema FROM form_definition
         WHERE service_type_id = $1 AND form_type = $2`,
        [rows[0].service_type_id, pending.required_form_key]
      );
      if (!fd.length) return res.status(422).json({ errors: { form: 'Unknown form' } });
      const errors = await validateFormResponse(fd[0].field_schema, body.form, {
        db: pool,
        userId: req.user.id,
      });
      if (Object.keys(errors).length) return res.status(422).json({ errors });
      formValidated = true;
      // The completion response lives on the task (nullable until completed).
      beforeCommit = (tx, ctx) =>
        ctx.task
          ? tx.query('UPDATE task SET completion_form_response = $1 WHERE id = $2', [
              JSON.stringify(body.form),
              ctx.task.id,
            ])
          : null;
    }

    const result = await executeTransition({
      requestId: id,
      user: req.user,
      transitionKey,
      note: body.note ?? null,
      expectedStatus: typeof body.expected_status === 'string' ? body.expected_status : null,
      formValidated,
      beforeCommit,
    });
    res.json({ request: { id, status: result.status } });
  } catch (err) {
    next(err);
  }
});

// PATCH /requests/{id}/cancel — user: via the workflow's own user-role
// cancel transition, and only while no task exists (checked under the
// engine's row lock, so the cancel-vs-assign race of must-pass #13 always
// leaves one side with 409); monitor: any state, as an override. No status
// key in code — the cancel target is derived from the data as the target of
// the user-role transition into a terminated-category status.
router.patch('/:id/cancel', async (req, res, next) => {
  try {
    if (req.user.role === 'employee' && !isOversight(req.user)) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) return res.status(404).json({ error: 'Not found' });
    const note = (req.body || {}).note ?? null;

    const { rows } = await pool.query(
      `SELECT w.statuses, w.transitions
       FROM request r JOIN workflow_definition w ON w.service_type_id = r.service_type_id
       WHERE r.id = $1`,
      [id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Not found' });
    const { statuses, transitions } = rows[0];
    // The cancel target is derived from the data: the requester transition
    // out of the initial status into a terminal one — never confirm, which
    // is also requester→terminal but fires later in the flow. No status key
    // in code (§9).
    const isInitial = (key) => statuses.some((s) => s.key === key && s.is_initial);
    const cancelTransition = transitions.find(
      (t) => t.actor === 'requester' && isTerminal(statuses, t.to) && isInitial(t.from)
    );
    if (!cancelTransition) {
      return res.status(409).json({ error: 'This request cannot be cancelled' });
    }

    const oversight = isOversight(req.user);
    let result;
    try {
      result = await executeTransition({
        requestId: id,
        user: req.user,
        // Oversight cancels from any state as an override; the requester fires
        // their own cancel transition (only while unassigned — the engine's
        // requester-terminal guard enforces it under the row lock).
        ...(oversight
          ? { to: cancelTransition.to, override: true }
          : { transitionKey: cancelTransition.key }),
        note,
      });
    } catch (err) {
      // For the owner, "a cancel path exists from here but not for your
      // role" means the request has moved past the cancellable window — a
      // state conflict (Section 7: cancel-after-assignment → 409), not a
      // permissions failure.
      if (req.user.role === 'user' && err instanceof WorkflowError && err.status === 403) {
        throw new WorkflowError(409, 'This request can no longer be cancelled');
      }
      throw err;
    }
    res.json({ request: { id, status: result.status } });
  } catch (err) {
    next(err);
  }
});

// PATCH /requests/{id}/status — oversight override (Section 7, constrained).
// The engine's resolveOverride enforces: target key exists (422), not the
// initial status (422), not the current status (409), note always (422).
// Reopening past a terminal status unlocks the task automatically because the
// task lock is a function of is_terminal, not a flag (Section 5).
router.patch('/:id/status', requireCapability('override'), async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) return res.status(404).json({ error: 'Not found' });
    const { to, note } = req.body || {};
    if (typeof to !== 'string' || !to) {
      return res.status(422).json({ errors: { to: 'A target status is required' } });
    }
    const result = await executeTransition({
      requestId: id,
      user: req.user,
      to,
      note: note ?? null,
      override: true,
    });
    res.json({ request: { id, status: result.status } });
  } catch (err) {
    next(err);
  }
});

// Shared by the comment routes: Section 6 comment cells — user own (404
// otherwise), monitor any, employee never. Returns the request row or null
// after having written the error response.
async function loadCommentableRequest(req, res) {
  if (req.user.role === 'employee' && !isOversight(req.user)) {
    res.status(403).json({ error: 'Forbidden' });
    return null;
  }
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) {
    res.status(404).json({ error: 'Not found' });
    return null;
  }
  const { rows } = await pool.query(
    `SELECT r.id, r.user_id, st.name AS service_name, st.owner_id
     FROM request r JOIN service_type st ON st.id = r.service_type_id
     WHERE r.id = $1`,
    [id]
  );
  if (
    !rows.length ||
    (req.user.role === 'user' && rows[0].user_id !== req.user.id) ||
    // Gate 2: an oversight employee comments only within their subtree.
    (isOversight(req.user) && !(await ownerInScope(req.user.id, rows[0].owner_id)))
  ) {
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
      const message = JSON.stringify({
        en: `${req.user.name} commented on request #${request.id} (${pick(request.service_name, 'en')}).`,
        ar: `علّق ${req.user.name} على الطلب رقم ${request.id} (${pick(request.service_name, 'ar')}).`,
      });
      if (isOversight(req.user)) {
        // Oversight → the requester.
        await client.query(
          `INSERT INTO notification (user_id, request_id, type, message)
           VALUES ($1, $2, 'comment', $3)`,
          [request.user_id, request.id, message]
        );
      } else if (request.owner_id) {
        // Requester → the service's oversight owner (the other party).
        await client.query(
          `INSERT INTO notification (user_id, request_id, type, message)
           VALUES ($1, $2, 'comment', $3)`,
          [request.owner_id, request.id, message]
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
router.patch('/:id/priority', requireCapability('set_priority'), async (req, res, next) => {
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
      `SELECT r.id, r.status, r.priority, st.owner_id
       FROM request r JOIN service_type st ON st.id = r.service_type_id
       WHERE r.id = $1 FOR UPDATE OF r`,
      [id]
    );
    // Gate 2: out-of-subtree requests look nonexistent (404-over-403).
    if (!rows.length || !(await ownerInScope(req.user.id, rows[0].owner_id, client))) {
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
      // Operational audit, same transaction (§6 re-scope, I9).
      await logAudit(client, req.user.id, 'request.priority_changed', 'request', id, {
        from: request.priority,
        to: priority,
      });
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
router.patch('/:id/assign', requireCapability('assign'), async (req, res, next) => {
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
      `SELECT r.id, r.status, r.service_type_id, st.owner_id, st.name AS service_name,
              w.statuses, w.transitions
       FROM request r
       JOIN service_type st ON st.id = r.service_type_id
       JOIN workflow_definition w ON w.service_type_id = r.service_type_id
       WHERE r.id = $1
       FOR UPDATE OF r`,
      [id]
    );
    // Gate 2: an oversight employee assigns only within their subtree; an
    // out-of-subtree request looks nonexistent (404-over-403).
    if (!rows.length || !(await ownerInScope(req.user.id, rows[0].owner_id, client))) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Not found' });
    }
    const request = rows[0];

    // Assignment rule (Gate 2): the assignee must be an active employee inside
    // the assigning oversight actor's subtree — 422 otherwise (this is what
    // makes a cross-team assignment fail, must-pass #16).
    const scope = await subtreeIds(req.user.id, client);
    const { rows: empRows } = await client.query(
      `SELECT id, name, is_active FROM users WHERE id = $1 AND role = 'employee'`,
      [employeeId]
    );
    const employee = empRows[0];
    if (!employee || !employee.is_active || !scope.includes(employee.id)) {
      await client.query('ROLLBACK');
      return res.status(422).json({
        errors: { employeeId: 'Must be an active employee on your team' },
      });
    }

    const { rows: taskRows } = await client.query(
      'SELECT id, employee_id FROM task WHERE request_id = $1',
      [request.id]
    );
    const task = taskRows[0] || null;

    // The assign transition is the oversight (assign-capability) transition
    // out of the current status; its target is where work begins. Derived
    // from the data — no status key in code (§9).
    const assignTransition = request.transitions.find(
      (t) => t.from === request.status && t.required_capability === 'assign'
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
        transitionKey: assignTransition.key,
        note,
        // Audit this as an assignment (not a bare status change), with the
        // assignee — written in executeTransition's transaction.
        auditAction: 'request.assigned',
        auditDetail: { assigneeId: employee.id, assignee: employee.name, to: assignTransition.to },
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
          // The `assigned` notification is the transition's notify:
          // ['assigned_to'], resolved by the engine after this hook (Phase 5).
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
    // reassignment of an existing, still-open task is possible. A terminal
    // request can't be reassigned.
    if (!task || isTerminal(request.statuses, request.status)) {
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
    // Operational audit, same transaction (§6 re-scope, I9). The engine-path
    // (first) assignment is audited inside executeTransition below; this covers
    // in-place reassignment, which never enters the engine.
    await logAudit(client, req.user.id, 'request.assigned', 'request', request.id, {
      assigneeId: employee.id,
      assignee: employee.name,
      previous: prevRows[0].name,
    });
    // In-place reassignment is not a transition, so no notify data fires —
    // insert the `assigned` notification directly (bilingual, Phase 5).
    await client.query(
      'INSERT INTO notification (user_id, request_id, type, message) VALUES ($1, $2, $3, $4)',
      [
        employee.id,
        request.id,
        'assigned',
        JSON.stringify({
          en: `You have been assigned request #${request.id} (${pick(request.service_name, 'en')}).`,
          ar: `تم إسنادك إلى الطلب رقم ${request.id} (${pick(request.service_name, 'ar')}).`,
        }),
      ]
    );
    await client.query('COMMIT');

    res.json({
      request: { id: request.id, status: statusOf(request.statuses, request.status) },
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
