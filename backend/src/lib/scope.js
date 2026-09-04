// Gate 2 (scope): an employee's authority reaches their own DEPARTMENT, full
// stop — a flat model (re-scoped, user-directed: `users.manager_id` and the
// multi-level reporting tree it powered are gone; `department.head_user_id`
// is display metadata now, not a scope mechanism — every `view_all` holder in
// a department has equal Gate-2 reach over it, head or not). An employee with
// no department (department_id IS NULL) has a subtree of just themselves.
// One deliberate exception (added 2026-09-04, user-directed): an employee
// whose LEVEL grants the `view_all_company` capability gets the whole company
// as their scope instead, department membership skipped entirely — an
// operational, non-admin path to company-wide reach (a General Manager who
// still works requests/tasks, unlike the Owner, who holds no capabilities and
// doesn't operate the queue, I2). Orthogonal to every other capability, same
// as Gate 1 and Gate 2 are orthogonal to each other: view_all_company decides
// WHERE an employee's authority reaches, view_all decides WHAT they can see
// once there — holding only view_all_company still leaves Gate 1 limiting
// them to their own resources, just across a much bigger scope.
// Used for assignment candidates and request visibility. See CLAUDE.md §10.
const pool = require('../db');

// All user ids in `rootId`'s scope (inclusive): every employee sharing their
// department, or just themselves if they have none — or every user in the
// company if `rootId` holds view_all_company. Accepts a pooled client so it
// can run inside a transaction (e.g. the workflow engine's row lock).
async function subtreeIds(rootId, db = pool) {
  const { rows } = await db.query(
    `SELECT u2.id
     FROM users u1
     JOIN users u2 ON
       u2.id = u1.id
       OR EXISTS (
         SELECT 1 FROM level_capability lc
         WHERE lc.level_id = u1.level_id AND lc.capability_key = 'view_all_company'
       )
       OR (u1.department_id IS NOT NULL AND u2.department_id = u1.department_id)
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
     WHERE a.id = $1
       AND (
         EXISTS (
           SELECT 1 FROM level_capability lc
           WHERE lc.level_id = a.level_id AND lc.capability_key = 'view_all_company'
         )
         OR (a.department_id IS NOT NULL AND a.department_id = b.department_id)
       )`,
    [rootId, targetId]
  );
  return rows.length > 0;
}

// Gate 2's "whole company" case: the admin (Owner) has no department — they
// configure the deployment (I2), not a line role — so any owner-scoped query
// for them means every user (single-org per deployment, so "company-wide" is
// just "no owner_id filter"). An oversight employee gets their own department
// (or the whole company too, if their level holds view_all_company —
// subtreeIds resolves that).
async function ownerScopeIds(user, db = pool) {
  if (user.role === 'admin') {
    const { rows } = await db.query('SELECT id FROM users');
    return rows.map((r) => r.id);
  }
  return subtreeIds(user.id, db);
}

// Single-target counterpart of ownerScopeIds, for the per-resource 404 scope
// checks: same admin rule (no department, sees the whole company), otherwise
// the department-membership check (widened by view_all_company, same as
// ownerInScope). Use this instead of ownerInScope wherever the route admits
// the admin via requireCapabilityOrAdmin, or the Owner 404s on their own
// company's rows.
async function inOwnerScope(user, targetId, db = pool) {
  if (user.role === 'admin') return targetId != null;
  return ownerInScope(user.id, targetId, db);
}

module.exports = { subtreeIds, ownerInScope, ownerScopeIds, inOwnerScope };
