// Gate 2 (scope): an employee's authority reaches their SUBTREE — self plus all
// descendants via users.manager_id, at any depth (recursive CTE). A root
// employee (manager_id IS NULL) reaches the whole organisation with no special
// case. Used for assignment candidates and request visibility. See CLAUDE.md §10.
const pool = require('../db');

// All user ids in `rootId`'s subtree (inclusive). Accepts a pooled client so it
// can run inside a transaction (e.g. the workflow engine's row lock).
// `path` guards against a manager_id cycle in the data: a row is only
// expanded once its own id hasn't already been visited on this path, so a
// loop stops instead of recursing forever (2026-08-21 incident — a live
// 3-cycle in `users.manager_id` OOM-crashed the server on every request that
// touched it, since UNION ALL alone never terminates on a cycle).
async function subtreeIds(rootId, db = pool) {
  const { rows } = await db.query(
    `WITH RECURSIVE sub AS (
       SELECT id, ARRAY[id] AS path FROM users WHERE id = $1
       UNION ALL
       SELECT u.id, sub.path || u.id
       FROM users u JOIN sub ON u.manager_id = sub.id
       WHERE NOT u.id = ANY(sub.path)
     )
     SELECT id FROM sub`,
    [rootId]
  );
  return rows.map((r) => r.id);
}

// Cheaper single-target membership test (Gate 2 for one resource): is
// `targetId` inside `rootId`'s subtree? Used by the per-request 404 scope
// checks so they don't materialise the whole subtree.
async function ownerInScope(rootId, targetId, db = pool) {
  if (targetId == null) return false;
  const { rows } = await db.query(
    `WITH RECURSIVE sub AS (
       SELECT id, ARRAY[id] AS path FROM users WHERE id = $1
       UNION ALL
       SELECT u.id, sub.path || u.id
       FROM users u JOIN sub ON u.manager_id = sub.id
       WHERE NOT u.id = ANY(sub.path)
     )
     SELECT 1 FROM sub WHERE id = $2 LIMIT 1`,
    [rootId, targetId]
  );
  return rows.length > 0;
}

// Ancestors of `id` (inclusive), walking manager_id upward — the reverse
// direction of subtreeIds. Used to check whether re-pointing a group of
// users at a new manager would create a cycle (departmentHead.js): it would,
// iff `id` is already an ancestor of one of the users about to become its
// reports. Same path guard as subtreeIds.
async function ancestorIds(id, db = pool) {
  const { rows } = await db.query(
    `WITH RECURSIVE anc AS (
       SELECT id, manager_id, ARRAY[id] AS path FROM users WHERE id = $1
       UNION ALL
       SELECT u.id, u.manager_id, anc.path || u.id
       FROM users u JOIN anc ON u.id = anc.manager_id
       WHERE NOT u.id = ANY(anc.path)
     )
     SELECT id FROM anc`,
    [id]
  );
  return rows.map((r) => r.id);
}

// Gate 2's "whole company" case: the admin (Owner) has no subtree — they
// configure the deployment (I2), not a manager_id — so any owner-scoped
// query for them means every user (single-org per deployment, so "company-
// wide" is just "no owner_id filter"). An oversight employee gets their
// actual subtree.
async function ownerScopeIds(user, db = pool) {
  if (user.role === 'admin') {
    const { rows } = await db.query('SELECT id FROM users');
    return rows.map((r) => r.id);
  }
  return subtreeIds(user.id, db);
}

// Single-target counterpart of ownerScopeIds, for the per-resource 404 scope
// checks: same admin rule (no subtree, sees the whole company), otherwise the
// recursive subtree walk. Use this instead of ownerInScope wherever the route
// admits the admin via requireCapabilityOrAdmin, or the Owner 404s on their
// own company's rows.
async function inOwnerScope(user, targetId, db = pool) {
  if (user.role === 'admin') return targetId != null;
  return ownerInScope(user.id, targetId, db);
}

module.exports = { subtreeIds, ownerInScope, ownerScopeIds, inOwnerScope, ancestorIds };
