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
const bcrypt = require('bcryptjs');
const pool = require('../db');
const { requireAuth, requireRole } = require('../middleware/auth');
const { validateFieldSchema } = require('../lib/formSchema');
const { validateWorkflowDefinition } = require('../lib/workflowSchema');
const { isBilingual } = require('../lib/i18nLabel');
const { EVENTS } = require('../lib/webhooks');
const { withTx, logAudit } = require('../lib/audit');
const { CAPABILITIES } = require('../lib/capabilities');

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
              d.name AS department_name,
              o.login_identifier AS owner_login, o.name AS owner_name
       FROM service_type st
       JOIN department d ON d.id = st.department_id
       LEFT JOIN users o ON o.id = st.owner_id
       ORDER BY st.id`
    );
    res.json({
      services: rows.map((r) => ({
        id: r.id,
        ownerLogin: r.owner_login,
        ownerName: r.owner_name,
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
// Accepts `enabled` and/or `owner` — at least one. `owner` is an employee's
// login_identifier (null clears it). Owner matters because it is the Gate 2
// visibility anchor: an employee sees a service's requests when the service's
// owner_id is inside their subtree. A sector onboarded before any staff exist
// has owner_id NULL and is therefore invisible to everyone, so this has to be
// settable after the fact — otherwise the install order (services before
// employees) silently produces an unusable service.
router.patch('/services/:key', async (req, res, next) => {
  try {
    const body = req.body || {};
    const hasEnabled = body.enabled !== undefined;
    const hasOwner = body.owner !== undefined;
    const errors = [];
    if (!hasEnabled && !hasOwner) errors.push('body: provide enabled and/or owner');
    if (hasEnabled && typeof body.enabled !== 'boolean') errors.push('enabled: must be boolean');
    if (hasOwner && body.owner !== null && typeof body.owner !== 'string') {
      errors.push('owner: must be a login_identifier string or null');
    }
    if (errors.length) return res.status(422).json({ errors });

    const result = await withTx(async (client) => {
      const svc = await client.query(
        'SELECT id FROM service_type WHERE key = $1 FOR UPDATE',
        [req.params.key]
      );
      if (!svc.rowCount) return null;
      const id = svc.rows[0].id;
      const detail = { key: req.params.key };

      if (hasEnabled) {
        await client.query('UPDATE service_type SET enabled = $1 WHERE id = $2', [body.enabled, id]);
        detail.enabled = body.enabled;
      }
      if (hasOwner) {
        let ownerId = null;
        if (body.owner !== null) {
          const owner = await client.query(
            `SELECT id FROM users WHERE login_identifier = $1 AND role = 'employee'`,
            [body.owner]
          );
          if (!owner.rowCount) return 'bad_owner';
          ownerId = owner.rows[0].id;
        }
        await client.query('UPDATE service_type SET owner_id = $1 WHERE id = $2', [ownerId, id]);
        detail.owner = body.owner;
      }

      await logAudit(client, req.user.id, 'service.updated', 'service_type', id, detail);
      const { rows } = await client.query(
        'SELECT enabled, owner_id FROM service_type WHERE id = $1',
        [id]
      );
      return rows[0];
    });
    if (result === 'bad_owner') {
      return res.status(422).json({ errors: [`owner: no employee "${body.owner}"`] });
    }
    if (!result) return res.status(404).json({ error: 'Not found' });
    res.json({ key: req.params.key, enabled: result.enabled, ownerId: result.owner_id });
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
      `SELECT u.id, u.name, u.manager_id, u.is_active, u.login_identifier,
              d.name AS department_name,
              el.id AS level_id, el.name AS level_name,
              COALESCE(
                ARRAY_AGG(lc.capability_key) FILTER (WHERE lc.capability_key IS NOT NULL),
                '{}'
              ) AS capabilities
       FROM users u
       LEFT JOIN department d ON d.id = u.department_id
       LEFT JOIN employee_level el ON el.id = u.level_id
       LEFT JOIN level_capability lc ON lc.level_id = u.level_id
       WHERE u.role = 'employee'
       GROUP BY u.id, d.name, el.id, el.name
       ORDER BY u.name`
      // login_identifier is returned so the Services owner picker can send it
      // to PATCH /config/services/{key}, which resolves owners by that handle.
    );
    res.json({
      employees: rows.map((r) => ({
        id: r.id,
        name: r.name,
        loginIdentifier: r.login_identifier,
        managerId: r.manager_id,
        isActive: r.is_active,
        departmentName: r.department_name,
        levelId: r.level_id,
        levelName: r.level_name,
        capabilities: r.capabilities,
      })),
    });
  } catch (err) {
    next(err);
  }
});

// ── Levels & capability grants (admin only) ─────────────────────────────────
// Gate 1 is configured here and NOWHERE else. Deliberately admin-only, not
// manage_employees: if a manager could set levels they could grant a
// subordinate a capability they don't hold themselves — escalation by proxy —
// which would need a "may only grant what you hold" subset check on a hot
// path. Admin is outside the reporting tree and holds no capabilities (I2), so
// granting one gains them nothing and the subset rule isn't needed at all.
//
// Reporting lines (users.manager_id) are NOT editable here: both subtree CTEs
// use UNION ALL with no cycle detection (lib/scope.js), so a reorg that made
// two employees each other's manager would recurse forever on every scoped
// query. Reorg stays a seed-time concern (documented limitation).

// GET /config/capabilities — the fixed catalogue. It lives in code, not data.
router.get('/capabilities', (req, res) => {
  res.json({ capabilities: CAPABILITIES });
});

// GET /config/levels — levels, their grants, and how many employees sit at
// each (the blast radius of changing a grant, shown before you change it).
router.get('/levels', async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      `SELECT el.id, el.name,
              COALESCE(
                ARRAY_AGG(DISTINCT lc.capability_key)
                  FILTER (WHERE lc.capability_key IS NOT NULL),
                '{}'
              ) AS capabilities,
              COUNT(DISTINCT u.id)::int AS employee_count
       FROM employee_level el
       LEFT JOIN level_capability lc ON lc.level_id = el.id
       LEFT JOIN users u ON u.level_id = el.id AND u.role = 'employee'
       GROUP BY el.id, el.name
       ORDER BY el.id`
    );
    res.json({
      levels: rows.map((r) => ({
        id: r.id,
        name: r.name,
        capabilities: r.capabilities,
        employeeCount: r.employee_count,
      })),
    });
  } catch (err) {
    next(err);
  }
});

// Shared validation for a grant set: unknown keys are rejected rather than
// silently dropped, so a typo can't quietly create a powerless level.
function badCapabilities(capabilities) {
  if (!Array.isArray(capabilities)) return ['capabilities: required array'];
  return capabilities
    .filter((c) => !CAPABILITIES.includes(c))
    .map((c) => `capabilities: unknown capability "${c}"`);
}

router.post('/levels', async (req, res, next) => {
  try {
    const { name, capabilities } = req.body || {};
    const errors = [];
    if (!isBilingual(name)) errors.push('name: must be a {en, ar} object');
    errors.push(...badCapabilities(capabilities));
    if (errors.length) return res.status(422).json({ errors });

    const level = await withTx(async (client) => {
      const { rows } = await client.query(
        'INSERT INTO employee_level (name) VALUES ($1) RETURNING id',
        [JSON.stringify(name)]
      );
      const id = rows[0].id;
      for (const key of capabilities) {
        await client.query(
          'INSERT INTO level_capability (level_id, capability_key) VALUES ($1, $2)',
          [id, key]
        );
      }
      await logAudit(client, req.user.id, 'level.created', 'employee_level', id, {
        name: name.en,
        capabilities,
      });
      return id;
    });
    res.status(201).json({ id: level });
  } catch (err) {
    next(err);
  }
});

// PATCH /config/levels/:id — replace the grant set. Takes effect on the NEXT
// request for everyone at this level: capabilities are read from the DB per
// request (middleware/auth.js), never baked into the JWT. The audit detail
// records before AND after, since a grant change is invisible in the timeline.
router.patch('/levels/:id', async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) return res.status(404).json({ error: 'Not found' });
    const { capabilities } = req.body || {};
    const errors = badCapabilities(capabilities);
    if (errors.length) return res.status(422).json({ errors });

    const result = await withTx(async (client) => {
      const level = await client.query('SELECT id FROM employee_level WHERE id = $1 FOR UPDATE', [id]);
      if (!level.rowCount) return null;
      const before = await client.query(
        'SELECT capability_key FROM level_capability WHERE level_id = $1 ORDER BY capability_key',
        [id]
      );
      await client.query('DELETE FROM level_capability WHERE level_id = $1', [id]);
      for (const key of capabilities) {
        await client.query(
          'INSERT INTO level_capability (level_id, capability_key) VALUES ($1, $2)',
          [id, key]
        );
      }
      await logAudit(client, req.user.id, 'level.updated', 'employee_level', id, {
        before: before.rows.map((r) => r.capability_key),
        after: capabilities,
      });
      return true;
    });
    if (!result) return res.status(404).json({ error: 'Not found' });
    res.json({ id, capabilities });
  } catch (err) {
    next(err);
  }
});

// DELETE /config/levels/:id — remove a level nobody holds.
//
// users.level_id and level_capability.level_id are both RESTRICT foreign keys
// (migration 006), so the database already refuses to delete a level that has
// holders — but it surfaces as an opaque FK error. The holder check turns that
// into a 409 that says what to do: move those employees first. Grants are
// removed in the same transaction, since they'd otherwise block the delete.
//
// Audit rows referencing the level survive by design (audit_event has no FK —
// the trail outlives what it describes, I9); they render as "Level #<id>".
router.delete('/levels/:id', async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) return res.status(404).json({ error: 'Not found' });

    const result = await withTx(async (client) => {
      const level = await client.query(
        'SELECT id, name FROM employee_level WHERE id = $1 FOR UPDATE',
        [id]
      );
      if (!level.rowCount) return null;
      const held = await client.query(
        `SELECT COUNT(*)::int AS n FROM users WHERE level_id = $1 AND role = 'employee'`,
        [id]
      );
      if (held.rows[0].n > 0) return { conflict: held.rows[0].n };

      await client.query('DELETE FROM level_capability WHERE level_id = $1', [id]);
      await client.query('DELETE FROM employee_level WHERE id = $1', [id]);
      await logAudit(client, req.user.id, 'level.deleted', 'employee_level', id, {
        name: level.rows[0].name.en,
      });
      return { deleted: true };
    });

    if (!result) return res.status(404).json({ error: 'Not found' });
    if (result.conflict) {
      return res.status(409).json({
        error: `${result.conflict} employee(s) still hold this level — move them to another level first`,
      });
    }
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});

// PATCH /config/employees/:id/level — put an employee at a level (or null to
// strip them back to no capabilities). This is the only way to grow an
// oversight tier without re-seeding. Not on PATCH /employees/{id}: that route
// is gated by manage_employees, which an admin does not hold — they would 403
// on their own feature.
router.patch('/employees/:id/level', async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) return res.status(404).json({ error: 'Not found' });
    const { levelId } = req.body || {};
    if (levelId !== null && !Number.isInteger(levelId)) {
      return res.status(422).json({ errors: ['levelId: required integer or null'] });
    }

    const result = await withTx(async (client) => {
      if (levelId !== null) {
        const level = await client.query('SELECT 1 FROM employee_level WHERE id = $1', [levelId]);
        if (!level.rowCount) return 'bad_level';
      }
      const { rows } = await client.query(
        `UPDATE users SET level_id = $1 WHERE id = $2 AND role = 'employee'
         RETURNING id, name, level_id`,
        [levelId, id]
      );
      if (!rows.length) return null;
      await logAudit(client, req.user.id, 'employee.level_changed', 'user', id, {
        name: rows[0].name,
        levelId,
      });
      return rows[0];
    });
    if (result === 'bad_level') {
      return res.status(422).json({ errors: [`levelId: no level ${levelId}`] });
    }
    if (!result) return res.status(404).json({ error: 'Not found' });
    res.json({ id: result.id, levelId: result.level_id });
  } catch (err) {
    next(err);
  }
});

// POST /config/employees — create a ROOT employee (manager_id NULL).
//
// This exists to break a bootstrap deadlock. POST /employees is gated by
// manage_employees, admins hold no capabilities (I2), and a clean handover
// (SEED_DEMO_DATA=false) seeds only the admin — so on a fresh deployment
// nobody could create the first member of staff at all. The admin creates one
// root employee here; that person logs in and builds the rest of the tree
// through the normal Employees page, where Gate 2 applies as usual.
//
// Deliberately root-only: this is not a general employee CRUD back door. Every
// subsequent hire goes through the capability- and subtree-gated route.
router.post('/employees', async (req, res, next) => {
  try {
    const { name, email, password, phone, departmentId, levelId } = req.body || {};
    const errors = [];
    if (!name || typeof name !== 'string' || !name.trim()) errors.push('name: required');
    if (!email || typeof email !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      errors.push('email: valid email required');
    }
    if (!password || typeof password !== 'string' || password.length < 8) {
      errors.push('password: at least 8 characters');
    }
    if (levelId !== undefined && levelId !== null && !Number.isInteger(levelId)) {
      errors.push('levelId: integer or null');
    }
    if (departmentId !== undefined && departmentId !== null && !Number.isInteger(departmentId)) {
      errors.push('departmentId: integer or null');
    }
    if (errors.length) return res.status(422).json({ errors });

    const passwordHash = await bcrypt.hash(password, 10);
    let created;
    try {
      created = await withTx(async (client) => {
        if (levelId) {
          const lv = await client.query('SELECT 1 FROM employee_level WHERE id = $1', [levelId]);
          if (!lv.rowCount) return 'bad_level';
        }
        const { rows } = await client.query(
          `INSERT INTO users (name, email, password_hash, role, phone, department_id,
                              manager_id, level_id, login_identifier)
           VALUES ($1, $2, $3, 'employee', $4, $5, NULL, $6, $2)
           RETURNING id, name, email`,
          [name.trim(), email.toLowerCase(), passwordHash, phone || null,
           departmentId ?? null, levelId ?? null]
        );
        await logAudit(client, req.user.id, 'employee.created', 'user', rows[0].id, {
          email: rows[0].email,
          root: true,
        });
        return rows[0];
      });
    } catch (err) {
      if (err.code === '23505') {
        return res.status(422).json({ errors: ['email: already registered'] });
      }
      throw err;
    }
    if (created === 'bad_level') {
      return res.status(422).json({ errors: [`levelId: no level ${levelId}`] });
    }
    res.status(201).json({ id: created.id, name: created.name, email: created.email });
  } catch (err) {
    next(err);
  }
});

// PATCH /config/employees/:id/activate | /deactivate — account lifecycle for
// employees the reporting tree can't reach.
//
// The mirror of the root-creation deadlock above: a ROOT employee has
// manager_id NULL, so it is in nobody's subtree — every oversight actor gets
// 404 (Gate 2 doing its job) and the admin gets 403 (no capabilities). Nobody
// could disable one, including the root itself (a manager may never edit their
// own record). If a company's root employee left, the account stayed live.
//
// Scoped to any employee rather than roots only: "admin manages accounts and
// configuration" is a simpler rule than "admin manages accounts the tree can't
// reach", and a special case here would be one more thing to get wrong. The
// open-tasks 409 from the capability-gated route applies identically — an
// account holding live work is never silently disabled.
async function hasOpenTasks(employeeId) {
  const { rows } = await pool.query(
    `SELECT 1
     FROM task t
     JOIN request r ON r.id = t.request_id
     JOIN workflow_definition w ON w.service_type_id = r.service_type_id
     CROSS JOIN LATERAL jsonb_array_elements(w.statuses) s
     WHERE t.employee_id = $1
       AND s->>'key' = t.status
       AND (s->>'is_terminal')::boolean = FALSE
     LIMIT 1`,
    [employeeId]
  );
  return rows.length > 0;
}

async function setEmployeeActive(req, res, next, isActive) {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) return res.status(404).json({ error: 'Not found' });

    const { rows } = await pool.query(
      `SELECT id FROM users WHERE id = $1 AND role = 'employee'`,
      [id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Not found' });

    if (!isActive && (await hasOpenTasks(id))) {
      return res
        .status(409)
        .json({ error: 'Employee has open tasks — reassign them before deactivating' });
    }

    await withTx(async (client) => {
      await client.query('UPDATE users SET is_active = $1 WHERE id = $2', [isActive, id]);
      await logAudit(
        client,
        req.user.id,
        isActive ? 'employee.activated' : 'employee.deactivated',
        'user',
        id
      );
    });
    res.json({ id, isActive });
  } catch (err) {
    next(err);
  }
}

router.patch('/employees/:id/activate', (req, res, next) =>
  setEmployeeActive(req, res, next, true)
);
router.patch('/employees/:id/deactivate', (req, res, next) =>
  setEmployeeActive(req, res, next, false)
);

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
