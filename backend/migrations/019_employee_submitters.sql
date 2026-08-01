-- Time Off engine change (v7): let a service accept employees as requesters,
-- mirroring accepts_external_users (010_config_webhooks.sql) exactly.
-- Default FALSE — every existing service stays closed to employee submitters
-- unless explicitly opened (Time Off will be seeded with this TRUE).
ALTER TABLE service_type
  ADD COLUMN accepts_employee_submitters BOOLEAN NOT NULL DEFAULT FALSE;
