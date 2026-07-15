// Gate 2 (scope): an employee's authority reaches their SUBTREE — self plus all
// descendants via users.manager_id, at any depth (recursive CTE). A root
// employee (manager_id IS NULL) reaches the whole organisation with no special
// case. Used for assignment candidates and request visibility. See CLAUDE.md §10.
const pool = require('../db');

// All user ids in `rootId`'s subtree (inclusive). Accepts a pooled client so it
// can run inside a transaction (e.g. the workflow engine's row lock).
async function subtreeIds(rootId, db = pool) {
  const { rows } = await db.query(
    `WITH RECURSIVE sub AS (
       SELECT id FROM users WHERE id = $1
       UNION ALL
       SELECT u.id FROM users u JOIN sub ON u.manager_id = sub.id
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
       SELECT id FROM users WHERE id = $1
       UNION ALL
       SELECT u.id FROM users u JOIN sub ON u.manager_id = sub.id
     )
     SELECT 1 FROM sub WHERE id = $2 LIMIT 1`,
    [rootId, targetId]
  );
  return rows.length > 0;
}

module.exports = { subtreeIds, ownerInScope };
