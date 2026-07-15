-- Migration 006 — Phase 1+2 of the Operiva migration: identity + reporting tree
-- + two-gate permission model. Replaces the hardcoded `monitor` role with
-- three account kinds (admin/employee/user) whose authority comes from a LEVEL
-- (Gate 1: capabilities) and a SUBTREE (Gate 2: manager_id). See CLAUDE.md §10.

-- 1. Account kinds. `monitor` dissolves into `employee` (an employee at an
--    oversight level). role now holds the account KIND, not authority.
ALTER TABLE users DROP CONSTRAINT users_role_check;
UPDATE users SET role = 'employee' WHERE role = 'monitor';
ALTER TABLE users ADD CONSTRAINT users_role_check
  CHECK (role IN ('admin', 'employee', 'user'));

-- 2. Reporting tree + generic login identifier + level. Employees may have no
--    email (they log in with an employee number), so email becomes nullable.
ALTER TABLE users
  ADD COLUMN manager_id       INTEGER REFERENCES users(id),
  ADD COLUMN login_identifier TEXT,
  ADD COLUMN level_id         INTEGER;
UPDATE users SET login_identifier = email WHERE login_identifier IS NULL;
ALTER TABLE users ALTER COLUMN login_identifier SET NOT NULL;
ALTER TABLE users ADD CONSTRAINT users_login_identifier_unique UNIQUE (login_identifier);
ALTER TABLE users ALTER COLUMN email DROP NOT NULL;

-- 3. Levels (named grades, per deployment) and the capability catalogue +
--    grants. Gate 1 = "does the actor's level grant the required capability?".
CREATE TABLE employee_level (
  id   SERIAL PRIMARY KEY,
  name TEXT NOT NULL          -- Phase 3 makes this bilingual {en,ar}
);

CREATE TABLE capability (
  key TEXT PRIMARY KEY
);

CREATE TABLE level_capability (
  level_id       INTEGER NOT NULL REFERENCES employee_level(id),
  capability_key TEXT    NOT NULL REFERENCES capability(key),
  PRIMARY KEY (level_id, capability_key)
);

ALTER TABLE users
  ADD CONSTRAINT users_level_fk FOREIGN KEY (level_id) REFERENCES employee_level(id);

-- 4. Subtree request-visibility anchor: which oversight employee owns a
--    service's queue. A request is visible to an employee whose subtree
--    contains this owner (self = owns it; ancestors oversee it). department_id
--    stays for display/grouping only — it no longer scopes anything.
ALTER TABLE service_type ADD COLUMN owner_id INTEGER REFERENCES users(id);

CREATE INDEX idx_users_manager ON users(manager_id);
