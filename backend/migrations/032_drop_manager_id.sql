-- Re-scoped, user-directed: drop the manager-tree architecture in favor of a
-- flat department-head model. users.manager_id (006) and the recursive-CTE
-- Gate 2 it powered (lib/scope.js) are gone — Gate 2 scope is now just
-- department co-membership, and department.head_user_id (020) is display
-- metadata rather than a scope mechanism (every view_all holder in a
-- department has equal Gate-2 reach over it, head or not).
ALTER TABLE users DROP COLUMN manager_id;
