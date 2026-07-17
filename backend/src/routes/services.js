// Read-only service config endpoints (CLAUDE.md Section 7). Definitions are
// seed-only — there are deliberately no write routes here.
const express = require('express');
const pool = require('../db');
const { requireAuth } = require('../middleware/auth');
const { subtreeIds } = require('../lib/scope');

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
              st.default_priority, st.accepts_external_users
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

module.exports = router;
