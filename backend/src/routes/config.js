// Phase 7 (§10): the config API — a sector is onboarded as JSON, no code change,
// and outbound webhook subscriptions are managed here too. Admin-only: config is
// the admin's job (they gate by role, not capability — CLAUDE.md admin model),
// so this uses requireRole('admin').
// NOTE: openapi.yaml calls for a `configure` capability; the shipped platform has
// no such capability (admins hold none — they configure by role). requireRole is
// the faithful gate; the openapi wording is corrected in this phase.
//
// POST /config/services reuses the EXISTING seed-time validators verbatim
// (validateFieldSchema + validateWorkflowDefinition) — the whole thesis is that
// the same validators guard both the seed path and the API path.
const express = require('express');
const pool = require('../db');
const { requireAuth, requireRole } = require('../middleware/auth');
const { validateFieldSchema } = require('../lib/formSchema');
const { validateWorkflowDefinition } = require('../lib/workflowSchema');
const { isBilingual } = require('../lib/i18nLabel');
const { EVENTS } = require('../lib/webhooks');
const { withTx, logAudit } = require('../lib/audit');

const router = express.Router();
router.use(requireAuth, requireRole('admin'));

const FORM_KEYS = ['request', 'completion'];

// Translate the API ServiceConfig shape into the internal workflow shape the
// seed-time validator expects: the API carries `initial_status` at the workflow
// level, the engine wants `is_initial` per status. Transitions already match the
// stored shape; fill the two optional fields the validator requires.
function toWorkflow(workflow) {
  const statuses = (workflow.statuses || []).map((s) => ({
    key: s.key,
    label: s.label,
    is_initial: s.key === workflow.initial_status,
    is_terminal: s.is_terminal === true,
    sla_minutes: s.sla_minutes ?? null,
  }));
  const transitions = (workflow.transitions || []).map((t) => ({
    key: t.key,
    label: t.label,
    from: t.from,
    to: t.to,
    required_capability: t.required_capability ?? null,
    actor: t.actor ?? null,
    required_form_key: t.required_form_key ?? null,
    requires_note: t.requires_note === true,
    // Every transition notifies the requester by convention (company-config.js);
    // the client may add assigned_to / assignee_manager.
    notify: Array.isArray(t.notify) ? t.notify : ['created_by'],
  }));
  return { statuses, transitions };
}

// POST /config/services — onboard a sector. One JSON call, zero code change.
router.post('/services', async (req, res, next) => {
  const client = await pool.connect();
  try {
    const { service, workflow, forms } = req.body || {};
    const problems = [];

    if (!service || typeof service !== 'object') problems.push('service: required');
    else {
      if (!service.key || typeof service.key !== 'string') problems.push('service.key: required string');
      if (!isBilingual(service.name)) problems.push('service.name: must be a {en, ar} object');
      if (typeof service.accepts_external_users !== 'boolean') {
        problems.push('service.accepts_external_users: required boolean');
      }
      if (!isBilingual(service.department && service.department.name)) {
        problems.push('service.department.name: must be a {en, ar} object');
      }
    }
    if (!forms || typeof forms !== 'object') problems.push('forms: required object');
    else {
      for (const key of FORM_KEYS) {
        if (!Array.isArray(forms[key])) problems.push(`forms.${key}: required field array`);
      }
      for (const key of Object.keys(forms)) {
        if (!FORM_KEYS.includes(key)) problems.push(`forms.${key}: unknown form type`);
      }
    }
    if (!workflow || typeof workflow !== 'object') problems.push('workflow: required object');

    // Only run the field/workflow validators once the top-level shape is sane.
    if (!problems.length) {
      for (const key of FORM_KEYS) {
        for (const err of validateFieldSchema(forms[key])) problems.push(`forms.${key}: ${err}`);
      }
      for (const err of validateWorkflowDefinition(toWorkflow(workflow))) {
        problems.push(`workflow: ${err}`);
      }
    }
    if (problems.length) return res.status(422).json({ errors: problems });

    await client.query('BEGIN');

    const dupe = await client.query('SELECT 1 FROM service_type WHERE key = $1', [service.key]);
    if (dupe.rowCount) {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: `A service with key "${service.key}" already exists` });
    }

    // Department: reuse one whose English name matches, else create it.
    const deptName = service.department.name;
    const dept = await client.query(`SELECT id FROM department WHERE name->>'en' = $1`, [deptName.en]);
    let departmentId = dept.rows[0] && dept.rows[0].id;
    if (!departmentId) {
      const ins = await client.query('INSERT INTO department (name) VALUES ($1) RETURNING id', [
        JSON.stringify(deptName),
      ]);
      departmentId = ins.rows[0].id;
    }

    // Optional owner (an existing oversight employee) so the sector's requests
    // fall in an oversight subtree. Omitted → owner_id null (no oversight view
    // until wired — documented limitation).
    let ownerId = null;
    if (service.owner) {
      const owner = await client.query(
        `SELECT id FROM users WHERE login_identifier = $1 AND role = 'employee'`,
        [service.owner]
      );
      if (!owner.rowCount) {
        await client.query('ROLLBACK');
        return res.status(422).json({ errors: [`service.owner: no employee "${service.owner}"`] });
      }
      ownerId = owner.rows[0].id;
    }

    const wf = toWorkflow(workflow);
    const { rows } = await client.query(
      `INSERT INTO service_type (key, name, department_id, owner_id, default_priority,
         enabled, accepts_external_users)
       VALUES ($1, $2, $3, $4, $5, TRUE, $6) RETURNING id`,
      [
        service.key,
        JSON.stringify(service.name),
        departmentId,
        ownerId,
        service.default_priority || 'medium',
        service.accepts_external_users,
      ]
    );
    const serviceTypeId = rows[0].id;

    await client.query(
      `INSERT INTO form_definition (service_type_id, form_type, field_schema)
       VALUES ($1, 'request', $2), ($1, 'completion', $3)`,
      [serviceTypeId, JSON.stringify(forms.request), JSON.stringify(forms.completion)]
    );
    await client.query(
      `INSERT INTO workflow_definition (service_type_id, statuses, transitions)
       VALUES ($1, $2, $3)`,
      [serviceTypeId, JSON.stringify(wf.statuses), JSON.stringify(wf.transitions)]
    );

    await client.query(
      `INSERT INTO audit_event (actor_id, action, entity_type, entity_id, detail)
       VALUES ($1, 'service.created', 'service_type', $2, $3)`,
      [req.user.id, serviceTypeId, JSON.stringify({ key: service.key })]
    );

    await client.query('COMMIT');
    res.status(201).json({ service_key: service.key, serviceTypeId });
  } catch (err) {
    await client.query('ROLLBACK');
    next(err);
  } finally {
    client.release();
  }
});

// GET /config/services — every configured service (admin view; not filtered by
// enabled or accepts_external_users, unlike the public /services catalogue).
router.get('/services', async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      // id is returned so the admin UI can read the stored definition back via
      // the existing GET /services/{id}/workflow and /forms/{formType}.
      `SELECT st.id, st.key, st.name, st.enabled, st.accepts_external_users,
              d.name AS department_name
       FROM service_type st JOIN department d ON d.id = st.department_id
       ORDER BY st.id`
    );
    res.json({
      services: rows.map((r) => ({
        id: r.id,
        key: r.key,
        name: r.name,
        departmentName: r.department_name,
        enabled: r.enabled,
        acceptsExternalUsers: r.accepts_external_users,
      })),
    });
  } catch (err) {
    next(err);
  }
});

// PATCH /config/services/:key — enable/disable a service. There is deliberately
// NO delete: service_type anchors request / form_definition / workflow_definition,
// so removing one would orphan or cascade away historical requests and take
// request_status_history with them (I9 — the audit trail is never deleted).
// Disabling is the documented way to retire a definition (§3): it drops out of
// the public catalogue while in-flight requests keep running their workflow.
router.patch('/services/:key', async (req, res, next) => {
  try {
    const { enabled } = req.body || {};
    if (typeof enabled !== 'boolean') {
      return res.status(422).json({ errors: ['enabled: required boolean'] });
    }
    const updated = await withTx(async (client) => {
      const { rows } = await client.query(
        'UPDATE service_type SET enabled = $1 WHERE key = $2 RETURNING id, enabled',
        [enabled, req.params.key]
      );
      if (!rows.length) return null;
      await logAudit(client, req.user.id, 'service.updated', 'service_type', rows[0].id, {
        key: req.params.key,
        enabled,
      });
      return rows[0];
    });
    if (!updated) return res.status(404).json({ error: 'Not found' });
    res.json({ key: req.params.key, enabled: updated.enabled });
  } catch (err) {
    next(err);
  }
});

// GET /config/org — the reporting tree plus each employee's capability grant.
// Two ORTHOGONAL axes, not a role ladder (I2): `managerId` is Gate 2 (subtree
// scope) and `capabilities` is Gate 1 (what the level grants). Someone deep in
// the tree may hold view_all; a root employee may hold almost nothing. Returned
// flat — the client nests it — so this stays one query with no recursion.
router.get('/org', async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      `SELECT u.id, u.name, u.manager_id, u.is_active,
              d.name AS department_name,
              el.name AS level_name,
              COALESCE(
                ARRAY_AGG(lc.capability_key) FILTER (WHERE lc.capability_key IS NOT NULL),
                '{}'
              ) AS capabilities
       FROM users u
       LEFT JOIN department d ON d.id = u.department_id
       LEFT JOIN employee_level el ON el.id = u.level_id
       LEFT JOIN level_capability lc ON lc.level_id = u.level_id
       WHERE u.role = 'employee'
       GROUP BY u.id, d.name, el.name
       ORDER BY u.name`
    );
    res.json({
      employees: rows.map((r) => ({
        id: r.id,
        name: r.name,
        managerId: r.manager_id,
        isActive: r.is_active,
        departmentName: r.department_name,
        levelName: r.level_name,
        capabilities: r.capabilities,
      })),
    });
  } catch (err) {
    next(err);
  }
});

// ── Webhook subscriptions (admin CRUD) ──────────────────────────────────────
router.post('/webhooks', async (req, res, next) => {
  try {
    const { url, secret, events } = req.body || {};
    const errors = [];
    if (!url || typeof url !== 'string' || !/^https?:\/\//.test(url)) {
      errors.push('url: required http(s) URL');
    }
    if (!secret || typeof secret !== 'string' || secret.length < 8) {
      errors.push('secret: required string (min 8 chars)');
    }
    if (!Array.isArray(events) || !events.length) errors.push('events: required non-empty array');
    else {
      for (const e of events) if (!EVENTS.includes(e)) errors.push(`events: unknown event "${e}"`);
    }
    if (errors.length) return res.status(422).json({ errors });

    const { rows } = await pool.query(
      `INSERT INTO webhook_subscription (url, secret, events) VALUES ($1, $2, $3) RETURNING id`,
      [url, secret, events]
    );
    res.status(201).json({ id: rows[0].id });
  } catch (err) {
    next(err);
  }
});

router.get('/webhooks', async (req, res, next) => {
  try {
    // Never return the secret.
    const { rows } = await pool.query(
      `SELECT id, url, events, is_active, created_at FROM webhook_subscription ORDER BY id`
    );
    res.json({ webhooks: rows });
  } catch (err) {
    next(err);
  }
});

router.delete('/webhooks/:id', async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) return res.status(404).json({ error: 'Not found' });
    const { rowCount } = await pool.query('DELETE FROM webhook_subscription WHERE id = $1', [id]);
    if (!rowCount) return res.status(404).json({ error: 'Not found' });
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});

module.exports = router;
