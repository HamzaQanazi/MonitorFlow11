-- Auto-assign (CLAUDE.md §13 re-scope, deliberate — was previously on the
-- "deliberately not built" list). Opt-in per service, same shape as
-- accepts_external_users: an admin picks it when building the service
-- through Add Service, nothing else changes for services that don't opt in.
ALTER TABLE service_type ADD COLUMN auto_assign BOOLEAN NOT NULL DEFAULT FALSE;
