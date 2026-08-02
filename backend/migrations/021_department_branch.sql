-- Nest department under branch (company > branch > department). Nullable, not
-- a required FK: seed.js creates the bootstrap "General" department before
-- company/branch exist (users.department_id is NOT NULL, so an employee needs
-- a department before onboarding — which creates branches — has even run).
-- The app-level rule ("every new department needs a branch") is enforced in
-- routes/departments.js instead, same as other cross-field checks in this app.
ALTER TABLE department ADD COLUMN branch_id INTEGER REFERENCES branch(id) ON DELETE SET NULL;
CREATE INDEX idx_department_branch ON department(branch_id);
