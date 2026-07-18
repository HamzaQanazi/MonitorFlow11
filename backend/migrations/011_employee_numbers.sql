-- Employees log in with a 4-digit number instead of an EMP-xxxx / email handle.
--
-- Scheme: 1000 + (department_id ?? 0) * 100 — a block of 100 per department, and
-- 1000-1099 for employees with no department (the org root). Admins and external
-- `user` accounts are untouched: they keep their email as login_identifier.
--
-- Migrated in place (UPDATE by id) so the existing demo data survives —
-- request, request_status_history and audit_event all reference users.id, never
-- the login handle.
WITH numbered AS (
  SELECT id,
         1000 + COALESCE(department_id, 0) * 100
              + (ROW_NUMBER() OVER (PARTITION BY department_id ORDER BY id) - 1) AS n
  FROM users
  WHERE role = 'employee'
)
UPDATE users u
   SET login_identifier = numbered.n::text
  FROM numbered
 WHERE u.id = numbered.id;

-- ponytail: no CHECK constraint on the format. login_identifier is deliberately
-- generic (one column, one lookup, one flow — CLAUDE.md §4); a format check would
-- have to encode "digits for employees, email for everyone else" and re-split the
-- auth path it exists to keep whole. Allocation lives in lib/employeeNumber.js;
-- the pre-existing UNIQUE index is the real guard.
