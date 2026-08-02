// Departments (Section 7). Reads are open to admin + view_all (the service
// picker and the Employees Management page). Writes — create / rename /
// delete / reassign head — are the Owner-only Departments page: admin-only,
// mirroring the Add Service Wizard's admin-only writes in services.js.
const express = require('express');
const pool = require('../db');
const { requireAuth, requireRole } = require('../middleware/auth');
const { withTx, logAudit } = require('../lib/audit');
const { isBilingual } = require('../lib/i18nLabel');
const { reassignDepartmentHead } = require('../lib/departmentHead');

const router = express.Router();
router.use(requireAuth);

// Validate a list of candidate employee ids: every id must be an integer and
// resolve to an active employee. Returns the offending field name, or null.
async function invalidEmployeeIds(ids) {
  if (!ids.length) return null;
  if (!ids.every((v) => Number.isInteger(v))) return 'not an integer';
  const { rows } = await pool.query(
    "SELECT id FROM users WHERE id = ANY($1) AND role = 'employee' AND is_active = TRUE",
    [ids]
  );
  const found = new Set(rows.map((r) => r.id));
  const missing = ids.filter((id) => !found.has(id));
  return missing.length ? `unknown or inactive employee id(s): ${missing.join(', ')}` : null;
}

// A department's branch must be one of this company's own branches (branch
// is company-scoped; department isn't, so this is the one cross-check needed).
async function invalidBranchId(branchId, companyId) {
  if (!Number.isInteger(branchId)) return true;
  const { rows } = await pool.query('SELECT 1 FROM branch WHERE id = $1 AND company_id = $2', [
    branchId,
    companyId,
  ]);
  return rows.length === 0;
}

// GET /departments — admin sees all (with head + member count, for the
// Departments page); an oversight employee sees only their own department,
// which keeps every department picker correct without client-side filtering.
router.get('/', async (req, res, next) => {
  try {
    const isAdmin = req.user.role === 'admin';
    if (!isAdmin && !(req.user.capabilities && req.user.capabilities.has('view_all'))) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    const { rows } = await pool.query(
      `SELECT d.id, d.name, d.head_user_id, h.name AS head_name, d.branch_id, b.name AS branch_name,
              (SELECT COUNT(*)::int FROM users m WHERE m.department_id = d.id) AS member_count
       FROM department d
       LEFT JOIN users h ON h.id = d.head_user_id
       LEFT JOIN branch b ON b.id = d.branch_id
       WHERE $1::boolean OR d.id = $2
       ORDER BY d.name`,
      [isAdmin, req.user.department_id]
    );
    res.json({
      departments: rows.map((r) => ({
        id: r.id,
        name: r.name,
        headUserId: r.head_user_id,
        headName: r.head_name,
        branchId: r.branch_id,
        branchName: r.branch_name,
        memberCount: r.member_count,
      })),
    });
  } catch (err) {
    next(err);
  }
});

// POST /departments (admin-only) — create with a mandatory head + at least
// one other member. Both get moved into the new department (department_id);
// every member other than the head also gets manager_id = head (Gate 2 —
// this is what gives the head real oversight of them). The head's own
// manager_id is left untouched (unrelated to which department they now head).
router.post('/', requireRole('admin'), async (req, res, next) => {
  try {
    const b = req.body || {};
    const errors = {};
    if (!isBilingual(b.name)) errors.name = 'Bilingual name (en + ar) is required';

    const headEmployeeId = b.headEmployeeId;
    if (!Number.isInteger(headEmployeeId)) errors.headEmployeeId = 'A department head is required';

    const memberEmployeeIds = Array.isArray(b.memberEmployeeIds)
      ? [...new Set(b.memberEmployeeIds)]
      : null;
    if (!memberEmployeeIds || !memberEmployeeIds.length) {
      errors.memberEmployeeIds = 'At least one other employee is required';
    } else if (memberEmployeeIds.includes(headEmployeeId)) {
      errors.memberEmployeeIds = 'Members must be different from the head';
    }

    const branchId = b.branchId;
    if (!Number.isInteger(branchId)) errors.branchId = 'A branch is required';

    if (Object.keys(errors).length) return res.status(422).json({ errors });

    const badHead = await invalidEmployeeIds([headEmployeeId]);
    if (badHead) errors.headEmployeeId = 'Invalid or inactive employee';
    const badMembers = await invalidEmployeeIds(memberEmployeeIds);
    if (badMembers) errors.memberEmployeeIds = 'Invalid or inactive employee(s)';
    if (await invalidBranchId(branchId, req.user.company_id)) errors.branchId = 'Invalid branch';
    if (Object.keys(errors).length) return res.status(422).json({ errors });

    const created = await withTx(async (tx) => {
      const { rows } = await tx.query(
        'INSERT INTO department (name, head_user_id, branch_id) VALUES ($1::jsonb, $2, $3) RETURNING id',
        [JSON.stringify(b.name), headEmployeeId, branchId]
      );
      const departmentId = rows[0].id;
      await tx.query('UPDATE users SET department_id = $1 WHERE id = $2', [departmentId, headEmployeeId]);
      await tx.query(
        'UPDATE users SET department_id = $1, manager_id = $2 WHERE id = ANY($3)',
        [departmentId, headEmployeeId, memberEmployeeIds]
      );
      await logAudit(tx, req.user.id, 'department.created', 'department', departmentId, {
        name: b.name,
        headEmployeeId,
        memberEmployeeIds,
        branchId,
      });
      return departmentId;
    });

    res.status(201).json({ departmentId: created });
  } catch (err) {
    next(err);
  }
});

// PATCH /departments/:id (admin-only) — rename, and optionally (re)assign the
// branch (branchId is optional here, unlike create — this is also how the
// bootstrap "General" seed department, which has no branch, gets one).
router.patch('/:id', requireRole('admin'), async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) return res.status(404).json({ error: 'Not found' });
    const { rows: existing } = await pool.query('SELECT id FROM department WHERE id = $1', [id]);
    if (!existing.length) return res.status(404).json({ error: 'Not found' });

    const b = req.body || {};
    if (!isBilingual(b.name)) return res.status(422).json({ errors: { name: 'Bilingual name (en + ar) is required' } });
    if (b.branchId !== undefined && (await invalidBranchId(b.branchId, req.user.company_id))) {
      return res.status(422).json({ errors: { branchId: 'Invalid branch' } });
    }

    await withTx(async (tx) => {
      await tx.query(
        'UPDATE department SET name = $1::jsonb, branch_id = COALESCE($2, branch_id) WHERE id = $3',
        [JSON.stringify(b.name), b.branchId ?? null, id]
      );
      await logAudit(tx, req.user.id, 'department.updated', 'department', id, { name: b.name, branchId: b.branchId });
    });
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});

// PATCH /departments/:id/head (admin-only) — manually reassign the head, e.g.
// after the automatic on-deactivation fallback (routes/employees.js) picked
// the outgoing head's manager and the Owner wants someone else instead.
router.patch('/:id/head', requireRole('admin'), async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) return res.status(404).json({ error: 'Not found' });
    const { rows: existing } = await pool.query('SELECT id FROM department WHERE id = $1', [id]);
    if (!existing.length) return res.status(404).json({ error: 'Not found' });

    const headEmployeeId = (req.body || {}).headEmployeeId;
    if (!Number.isInteger(headEmployeeId)) {
      return res.status(422).json({ errors: { headEmployeeId: 'A department head is required' } });
    }
    const bad = await invalidEmployeeIds([headEmployeeId]);
    if (bad) return res.status(422).json({ errors: { headEmployeeId: 'Invalid or inactive employee' } });

    await withTx(async (tx) => {
      await reassignDepartmentHead(tx, id, headEmployeeId, { moveIntoDepartment: true });
      await logAudit(tx, req.user.id, 'department.head_reassigned', 'department', id, { headEmployeeId });
    });
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});

// DELETE /departments/:id (admin-only) — refused (409) while any employee or
// service_type still references it, same "reassign/detach first" spirit as
// deactivating an employee who holds an open task.
router.delete('/:id', requireRole('admin'), async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) return res.status(404).json({ error: 'Not found' });
    const { rows: existing } = await pool.query('SELECT id FROM department WHERE id = $1', [id]);
    if (!existing.length) return res.status(404).json({ error: 'Not found' });

    const { rows: hasEmployees } = await pool.query('SELECT 1 FROM users WHERE department_id = $1 LIMIT 1', [id]);
    if (hasEmployees.length) {
      return res.status(409).json({ error: 'Department still has employees — move them out first' });
    }
    const { rows: hasServices } = await pool.query('SELECT 1 FROM service_type WHERE department_id = $1 LIMIT 1', [id]);
    if (hasServices.length) {
      return res.status(409).json({ error: 'Department still has services assigned to it' });
    }

    await withTx(async (tx) => {
      await tx.query('DELETE FROM department WHERE id = $1', [id]);
      await logAudit(tx, req.user.id, 'department.deleted', 'department', id);
    });
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});

module.exports = router;
