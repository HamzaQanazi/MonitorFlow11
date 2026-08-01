// Service config endpoints (CLAUDE.md Section 7). Reads are open to any
// authenticated role (below). Writes — POST / and PATCH /:id/enabled — are
// the "Add Service" builder: admin-only, reusing the SAME seed-time
// validators (formSchema.js/workflowSchema.js) that used to be the only
// thing exercising these rules, so nothing the UI can submit can violate a
// rule the engine doesn't already enforce.
const express = require('express');
const pool = require('../db');
const { requireAuth, requireRole } = require('../middleware/auth');
const { subtreeIds } = require('../lib/scope');
const { withTx, logAudit } = require('../lib/audit');
const { validateFieldSchema } = require('../lib/formSchema');
const { validateWorkflowDefinition } = require('../lib/workflowSchema');
const { isBilingual } = require('../lib/i18nLabel');

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
    // `?owned=true` scopes the list to services the caller oversees — owner_id
    // in their subtree (Gate 2), i.e. exactly the services whose requests they
    // can see. Used by the monitor Requests/Reports filter dropdowns so the
    // filter never offers a service that returns no rows.
    const params = [];
    let ownedClause = '';
    if (req.query.owned === 'true' && !externalOnly) {
      params.push(await subtreeIds(req.user.id));
      ownedClause = `AND st.owner_id = ANY($${params.length})`;
    }
    const { rows } = await pool.query(
      `SELECT st.id, st.name, st.department_id, d.name AS department_name,
              st.default_priority, st.accepts_external_users, st.accepts_employee_submitters
       FROM service_type st
       JOIN department d ON d.id = st.department_id
       WHERE st.enabled ${externalOnly ? 'AND st.accepts_external_users' : ''} ${ownedClause}
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

// POST / — the "Add Service" builder's one save. Admin-only (I2: this is a
// config action, not an oversight one — no capability, requireRole('admin')).
// Validates the whole shape server-side (I8) through the SAME validators
// seed.js used to be the only caller of, then writes service_type + both
// form_definition rows + workflow_definition in one transaction.
router.post('/', requireRole('admin'), async (req, res, next) => {
  try {
    const b = req.body || {};
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
    if (!Number.isInteger(b.ownerId)) errors.push('ownerId is required');

    errors.push(...validateFieldSchema(b.requestFields).map((e) => `requestFields ${e}`));
    errors.push(...validateFieldSchema(b.completionFields).map((e) => `completionFields ${e}`));
    errors.push(...validateWorkflowDefinition({ statuses: b.statuses, transitions: b.transitions }));
    // required_form_key names the FORM_DEFINITION a transition needs — the
    // only one filled after submission time is the completion form (the
    // request form is filled at submission, before any transition fires).
    for (const tr of Array.isArray(b.transitions) ? b.transitions : []) {
      if (tr.required_form_key != null && tr.required_form_key !== 'completion') {
        errors.push(`transitions "${tr.key}": required_form_key must be null or "completion"`);
      }
    }

    if (errors.length) return res.status(422).json({ errors });

    // Gate 2's visibility anchor must be a real employee inside the
    // management tree — an admin or non-existent id would make the service
    // creatable but undispatchable (no employee's subtree would ever resolve
    // it into scope).
    const { rows: ownerRows } = await pool.query("SELECT id FROM users WHERE id = $1 AND role = 'employee'", [
      b.ownerId,
    ]);
    if (!ownerRows.length) return res.status(422).json({ errors: ['ownerId must reference an existing employee'] });

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
           (name, department_id, default_priority, enabled, owner_id, key,
            accepts_external_users, accepts_employee_submitters)
         VALUES ($1::jsonb, $2, $3, TRUE, $4, $5, $6, $7)
         RETURNING id`,
        [
          JSON.stringify(b.name),
          b.departmentId,
          b.defaultPriority,
          b.ownerId,
          key,
          b.acceptsExternalUsers,
          b.acceptsEmployeeSubmitters,
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

module.exports = router;
