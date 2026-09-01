// Gate 2 (scope): an employee's authority reaches their own DEPARTMENT, full
// stop — a flat model (re-scoped, user-directed: `users.manager_id` and the
// multi-level reporting tree it powered are gone; `department.head_user_id`
// is display metadata now, not a scope mechanism — every `view_all` holder in
// a department has equal Gate-2 reach over it, head or not). An employee with
// no department (department_id IS NULL) has a subtree of just themselves.
// Used for assignment candidates and request visibility. See CLAUDE.md §10.
const pool = require('../db');

// All user ids in `rootId`'s scope (inclusive): every employee sharing their
// department, or just themselves if they have none. Accepts a pooled client
// so it can run inside a transaction (e.g. the workflow engine's row lock).
async function subtreeIds(rootId, db = pool) {
  const { rows } = await db.query(
    `SELECT u2.id
     FROM users u1
     JOIN users u2 ON u2.id = u1.id OR (u1.department_id IS NOT NULL AND u2.department_id = u1.department_id)
     WHERE u1.id = $1`,
    [rootId]
  );
  return rows.map((r) => r.id);
}

// Cheaper single-target membership test (Gate 2 for one resource): is
// `targetId` inside `rootId`'s scope? Used by the per-request 404 scope
// checks so they don't materialise the whole department.
async function ownerInScope(rootId, targetId, db = pool) {
  if (targetId == null) return false;
  if (targetId === rootId) return true;
  const { rows } = await db.query(
    `SELECT 1
     FROM users a
     JOIN users b ON b.id = $2
     WHERE a.id = $1 AND a.department_id IS NOT NULL AND a.department_id = b.department_id`,
    [rootId, targetId]
  );
  return rows.length > 0;
}

// Gate 2's "whole company" case: the admin (Owner) has no department — they
// configure the deployment (I2), not a line role — so any owner-scoped query
// for them means every user (single-org per deployment, so "company-wide" is
// just "no owner_id filter"). An oversight employee gets their own department.
async function ownerScopeIds(user, db = pool) {
  if (user.role === 'admin') {
    const { rows } = await db.query('SELECT id FROM users');
    return rows.map((r) => r.id);
  }
  return subtreeIds(user.id, db);
}

// Single-target counterpart of ownerScopeIds, for the per-resource 404 scope
// checks: same admin rule (no department, sees the whole company), otherwise
// the department-membership check. Use this instead of ownerInScope wherever
// the route admits the admin via requireCapabilityOrAdmin, or the Owner 404s
// on their own company's rows.
async function inOwnerScope(user, targetId, db = pool) {
  if (user.role === 'admin') return targetId != null;
  return ownerInScope(user.id, targetId, db);
}

module.exports = { subtreeIds, ownerInScope, ownerScopeIds, inOwnerScope };
