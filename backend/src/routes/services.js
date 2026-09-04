// Service config endpoints (CLAUDE.md Section 7). Reads are open to any
// authenticated role (below). Writes — POST / and PATCH /:id/enabled — are
// the "Add Service" builder: admin-only, reusing the SAME seed-time
// validators (formSchema.js/workflowSchema.js) that used to be the only
// thing exercising these rules, so nothing the UI can submit can violate a
// rule the engine doesn't already enforce.
const express = require('express');
const pool = require('../db');
const { requireAuth, requireRole } = require('../middleware/auth');
const { departmentScopeIds } = require('../lib/scope');
const { withTx, logAudit } = require('../lib/audit');
const { validateFieldSchema } = require('../lib/formSchema');
const { validateWorkflowDefinition } = require('../lib/workflowSchema');
const { isBilingual } = require('../lib/i18nLabel');
const { FEATURE_KEYS } = require('../lib/onboardingOptions');

const router = express.Router();
router.use(requireAuth);

// Any authenticated role may read config: employees need completion-form
// schemas, monitors need workflow metadata. Only the catalogue *page* is
// user-only (Section 6), and that lives in the User app.

router.get('/', async (req, res, next) => {
  try {
    // Phase 7: self-registered `user` accounts only see services that accept
    // external users; staff (employees/admins) reading config see all enabled
    // services. Paired with the POST /requests 403 guard — never UI-only.
    const externalOnly = req.user.role === 'user';
    // `?owned=true` scopes the list to services the caller oversees — its
    // department_id in their scope (Gate 2), i.e. exactly the services whose
    // requests they can see. Used by the monitor Requests/Reports filter
    // dropdowns so the filter never offers a service that returns no rows.
    // Admin-only: include disabled services. Without this the console had no
    // way to see (or re-enable) anything an admin had switched off — PATCH
    // /:id/enabled could turn a service off and it vanished from every list.
    const includeDisabled = req.query.includeDisabled === 'true' && req.user.role === 'admin';
    const params = [];
    let ownedClause = '';
    if (req.query.owned === 'true' && !externalOnly) {
      params.push(await departmentScopeIds(req.user));
      ownedClause = `AND st.department_id = ANY($${params.length})`;
    }
    const { rows } = await pool.query(
      `SELECT st.id, st.name, st.department_id, d.name AS department_name,
              st.default_priority, st.accepts_external_users, st.accepts_employee_submitters,
              st.auto_assign, st.feature_key, st.enabled,
              NOT EXISTS (SELECT 1 FROM request r WHERE r.service_type_id = st.id) AS editable
       FROM service_type st
       JOIN department d ON d.id = st.department_id
       WHERE ${includeDisabled ? 'TRUE' : 'st.enabled'} ${externalOnly ? 'AND st.accepts_external_users' : ''} ${ownedClause}
       ORDER BY st.id`,
      params
    );
    res.json({
      services: rows.map((r) => ({
        id: r.id,
        name: r.name,
        departmentId: r.department_id,
        departmentName: r.department_name,
        defaultPriority: r.default_priority,
        acceptsExternalUsers: r.accepts_external_users,
        acceptsEmployeeSubmitters: r.accepts_employee_submitters,
        autoAssign: r.auto_assign,
        featureKey: r.feature_key,
        enabled: r.enabled,
        // Whether the definition can still be edited (§3) — false once any
        // request has used it. Drives the Services page's Edit affordance.
        editable: r.editable,
      })),
    });
  } catch (err) {
    next(err);
  }
});

// Detail reads are not filtered by `enabled`: existing requests for a since-
// disabled service still need their forms and workflow to render.

router.get('/:id/forms/:formType', async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const { formType } = req.params;
    if (!Number.isInteger(id) || !['request', 'completion'].includes(formType)) {
      return res.status(404).json({ error: 'Not found' });
    }
    const { rows } = await pool.query(
      'SELECT id, field_schema FROM form_definition WHERE service_type_id = $1 AND form_type = $2',
      [id, formType]
    );
    if (!rows.length) return res.status(404).json({ error: 'Not found' });
    res.json({ serviceTypeId: id, formType, fields: rows[0].field_schema });
  } catch (err) {
    next(err);
  }
});

router.get('/:id/workflow', async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) return res.status(404).json({ error: 'Not found' });
    const { rows } = await pool.query(
      'SELECT statuses, transitions FROM workflow_definition WHERE service_type_id = $1',
      [id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Not found' });
    res.json({ serviceTypeId: id, statuses: rows[0].statuses, transitions: rows[0].transitions });
  } catch (err) {
    next(err);
  }
});

function slugify(s) {
  return (
    s
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '') || 'service'
  );
}

// Shared by POST / and PATCH /:id so an edit can never be validated more
// loosely than a create. Returns an array of human-readable problems.
function validateServicePayload(b) {
  const errors = [];

  if (!isBilingual(b.name)) errors.push('name must be a {en, ar} object with both languages');
  if (!Number.isInteger(b.departmentId)) errors.push('departmentId is required');
  if (!['low', 'medium', 'high'].includes(b.defaultPriority)) {
    errors.push('defaultPriority must be low, medium, or high');
  }
  if (typeof b.acceptsExternalUsers !== 'boolean') errors.push('acceptsExternalUsers must be a boolean');
  if (typeof b.acceptsEmployeeSubmitters !== 'boolean') {
    errors.push('acceptsEmployeeSubmitters must be a boolean');
  }
  // Optional - defaults to false (S13 re-scope: auto-assign is opt-in per
  // service, not the default for every new one).
  if (b.autoAssign !== undefined && typeof b.autoAssign !== 'boolean') {
    errors.push('autoAssign must be a boolean');
  }
  if (b.featureKey != null && !FEATURE_KEYS.has(b.featureKey)) {
    errors.push('featureKey must be null or a known onboarding feature key');
  }

  errors.push(...validateFieldSchema(b.requestFields).map((e) => `requestFields ${e}`));
  errors.push(...validateFieldSchema(b.completionFields).map((e) => `completionFields ${e}`));
  errors.push(...validateWorkflowDefinition({ statuses: b.statuses, transitions: b.transitions }));
  // required_form_key names the FORM_DEFINITION a transition needs - the only
  // one filled after submission time is the completion form (the request form
  // is filled at submission, before any transition fires).
  for (const tr of Array.isArray(b.transitions) ? b.transitions : []) {
    if (tr.required_form_key != null && tr.required_form_key !== 'completion') {
      errors.push(`transitions "${tr.key}": required_form_key must be null or "completion"`);
    }
  }

  return errors;
}

// GET /:id - everything the Add Service wizard needs to reopen a service in
// edit mode: the row itself plus both forms and the workflow, in one round
// trip. Admin-only, like the writes.
router.get('/:id', requireRole('admin'), async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) return res.status(404).json({ error: 'Not found' });

    const [{ rows: svc }, { rows: forms }, { rows: wf }, { rows: used }] = await Promise.all([
      pool.query(
        `SELECT st.id, st.key, st.name, st.department_id, st.default_priority, st.enabled,
                st.accepts_external_users, st.accepts_employee_submitters, st.auto_assign, st.feature_key
         FROM service_type st
         WHERE st.id = $1`,
        [id]
      ),
      pool.query('SELECT form_type, field_schema FROM form_definition WHERE service_type_id = $1', [id]),
      pool.query('SELECT statuses, transitions FROM workflow_definition WHERE service_type_id = $1', [id]),
      pool.query('SELECT 1 FROM request WHERE service_type_id = $1 LIMIT 1', [id]),
    ]);
    if (!svc.length) return res.status(404).json({ error: 'Not found' });
    const r = svc[0];

    res.json({
      service: {
        id: r.id,
        key: r.key,
        name: r.name,
        departmentId: r.department_id,
        defaultPriority: r.default_priority,
        enabled: r.enabled,
        acceptsExternalUsers: r.accepts_external_users,
        acceptsEmployeeSubmitters: r.accepts_employee_submitters,
        autoAssign: r.auto_assign,
        featureKey: r.feature_key,
        // Whether the definition is still editable (S3) - the client uses this
        // to offer or refuse edit mode without a second call.
        editable: used.length === 0,
        requestFields: forms.find((f) => f.form_type === 'request')?.field_schema ?? [],
        completionFields: forms.find((f) => f.form_type === 'completion')?.field_schema ?? [],
        statuses: wf[0]?.statuses ?? [],
        transitions: wf[0]?.transitions ?? [],
      },
    });
  } catch (err) {
    next(err);
  }
});

// POST / — the "Add Service" builder's one save. Admin-only (I2: this is a
// config action, not an oversight one — no capability, requireRole('admin')).
// Validates the whole shape server-side (I8) through the SAME validators
// seed.js used to be the only caller of, then writes service_type + both
// form_definition rows + workflow_definition in one transaction.
router.post('/', requireRole('admin'), async (req, res, next) => {
  try {
    const b = req.body || {};
    const errors = validateServicePayload(b);
    if (errors.length) return res.status(422).json({ errors });

    const baseKey = slugify(b.name.en);

    const result = await withTx(async (tx) => {
      let key = baseKey;
      let n = 1;
      // key uniqueness — service_type.key is UNIQUE; loop under the same
      // transaction rather than relying on a retry-on-conflict, since a
      // name collision here is rare and this keeps the SQL simple.
      // eslint-disable-next-line no-constant-condition
      while (true) {
        const { rows } = await tx.query('SELECT 1 FROM service_type WHERE key = $1', [key]);
        if (!rows.length) break;
        n += 1;
        key = `${baseKey}_${n}`;
      }

      const { rows: st } = await tx.query(
        `INSERT INTO service_type
           (name, department_id, default_priority, enabled, key,
            accepts_external_users, accepts_employee_submitters, auto_assign, feature_key)
         VALUES ($1::jsonb, $2, $3, TRUE, $4, $5, $6, $7, $8)
         RETURNING id`,
        [
          JSON.stringify(b.name),
          b.departmentId,
          b.defaultPriority,
          key,
          b.acceptsExternalUsers,
          b.acceptsEmployeeSubmitters,
          b.autoAssign ?? false,
          b.featureKey ?? null,
        ]
      );
      const serviceTypeId = st[0].id;

      await tx.query(
        `INSERT INTO form_definition (service_type_id, form_type, field_schema)
         VALUES ($1, 'request', $2::jsonb), ($1, 'completion', $3::jsonb)`,
        [serviceTypeId, JSON.stringify(b.requestFields), JSON.stringify(b.completionFields)]
      );
      await tx.query(
        `INSERT INTO workflow_definition (service_type_id, statuses, transitions)
         VALUES ($1, $2::jsonb, $3::jsonb)`,
        [serviceTypeId, JSON.stringify(b.statuses), JSON.stringify(b.transitions)]
      );

      await logAudit(tx, req.user.id, 'service.created', 'service_type', serviceTypeId, { key });
      return { serviceTypeId, key };
    });

    res.status(201).json({ serviceTypeId: result.serviceTypeId, key: result.key });
  } catch (err) {
    if (err.code === '23503') return res.status(422).json({ errors: ['Invalid departmentId'] });
    next(err);
  }
});

// PATCH /:id - edit a service that no request has used yet. S3's rule is
// "definitions are immutable once any request exists", not "immutable from
// birth" - before that point a typo in a field label meant rebuilding the
// whole service from scratch, because no edit path existed at all. Once even
// one request exists this 409s and the disable-and-recreate path (PATCH
// /:id/enabled) is the only option, exactly as before.
//
// Full replace, not a merge: the payload is the same shape POST takes and runs
// through the same validateServicePayload, so an edit can't reach a state a
// create couldn't. `key` is deliberately NOT re-derived from a renamed service
// - it is a stable handle other rows already point at.
router.patch('/:id', requireRole('admin'), async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) return res.status(404).json({ error: 'Not found' });

    const b = req.body || {};
    const errors = validateServicePayload(b);
    if (errors.length) return res.status(422).json({ errors });

    const result = await withTx(async (tx) => {
      // Lock the row so a request created concurrently can't slip past the
      // in-use check between here and the write.
      const { rows: svc } = await tx.query('SELECT id FROM service_type WHERE id = $1 FOR UPDATE', [id]);
      if (!svc.length) return { notFound: true };

      const { rows: used } = await tx.query('SELECT 1 FROM request WHERE service_type_id = $1 LIMIT 1', [id]);
      if (used.length) return { inUse: true };

      await tx.query(
        `UPDATE service_type SET
           name = $1::jsonb, department_id = $2, default_priority = $3,
           accepts_external_users = $4, accepts_employee_submitters = $5,
           auto_assign = $6, feature_key = $7
         WHERE id = $8`,
        [
          JSON.stringify(b.name),
          b.departmentId,
          b.defaultPriority,
          b.acceptsExternalUsers,
          b.acceptsEmployeeSubmitters,
          b.autoAssign ?? false,
          b.featureKey ?? null,
          id,
        ]
      );
      await tx.query(
        `UPDATE form_definition SET field_schema = $2::jsonb
         WHERE service_type_id = $1 AND form_type = 'request'`,
        [id, JSON.stringify(b.requestFields)]
      );
      await tx.query(
        `UPDATE form_definition SET field_schema = $2::jsonb
         WHERE service_type_id = $1 AND form_type = 'completion'`,
        [id, JSON.stringify(b.completionFields)]
      );
      await tx.query(
        `UPDATE workflow_definition SET statuses = $2::jsonb, transitions = $3::jsonb
         WHERE service_type_id = $1`,
        [id, JSON.stringify(b.statuses), JSON.stringify(b.transitions)]
      );

      await logAudit(tx, req.user.id, 'service.updated', 'service_type', id, { name: b.name });
      return { ok: true };
    });

    if (result.notFound) return res.status(404).json({ error: 'Not found' });
    if (result.inUse) {
      return res.status(409).json({
        error: 'This service already has requests — its definition is frozen. Disable it and create a new one instead.',
      });
    }
    res.json({ serviceTypeId: id });
  } catch (err) {
    if (err.code === '23503') return res.status(422).json({ errors: ['Invalid departmentId'] });
    next(err);
  }
});

// PATCH /:id/enabled — toggle only, no edit-in-place. This is the whole
// enforcement of "definitions are immutable once any request exists" (§3/§15)
// — there is no route that could violate it, by construction: to change
// something, create a new service and disable the old one here.
router.patch('/:id/enabled', requireRole('admin'), async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) return res.status(404).json({ error: 'Not found' });
    if (typeof (req.body || {}).enabled !== 'boolean') {
      return res.status(422).json({ errors: { enabled: 'enabled must be a boolean' } });
    }
    const enabled = req.body.enabled;

    const result = await withTx(async (tx) => {
      const { rows } = await tx.query(
        'UPDATE service_type SET enabled = $1 WHERE id = $2 RETURNING id',
        [enabled, id]
      );
      if (!rows.length) return null;
      await logAudit(tx, req.user.id, enabled ? 'service.enabled' : 'service.disabled', 'service_type', id);
      return rows[0];
    });

    if (!result) return res.status(404).json({ error: 'Not found' });
    res.json({ id, enabled });
  } catch (err) {
    next(err);
  }
});

// PATCH /:id/auto-assign — toggle only, same shape as /enabled. auto_assign
// isn't part of the immutable form/workflow definition (§3/§15) — it only
// affects requests submitted after the toggle, so unlike form/workflow
// content it's safe to flip on an existing, already-live service.
router.patch('/:id/auto-assign', requireRole('admin'), async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) return res.status(404).json({ error: 'Not found' });
    if (typeof (req.body || {}).autoAssign !== 'boolean') {
      return res.status(422).json({ errors: { autoAssign: 'autoAssign must be a boolean' } });
    }
    const autoAssign = req.body.autoAssign;

    const result = await withTx(async (tx) => {
      const { rows } = await tx.query(
        'UPDATE service_type SET auto_assign = $1 WHERE id = $2 RETURNING id',
        [autoAssign, id]
      );
      if (!rows.length) return null;
      await logAudit(tx, req.user.id, autoAssign ? 'service.auto_assign_enabled' : 'service.auto_assign_disabled', 'service_type', id);
      return rows[0];
    });

    if (!result) return res.status(404).json({ error: 'Not found' });
    res.json({ id, autoAssign });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
