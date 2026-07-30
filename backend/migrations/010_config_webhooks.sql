-- Phase 7 (§10): config API + outbound webhooks + optional external users.
--
-- service_type gains two config-driven fields:
--   • key  — a stable string handle so a sector can be onboarded/looked-up by
--            name via POST /config/services (the DB still keys everything by the
--            numeric id; `key` is only the config dedup/return handle).
--   • accepts_external_users — whether self-registered `user` accounts may see
--            and submit to this service (GET /services filters on it, POST
--            /requests enforces it server-side). Default TRUE so the two seeded
--            public services keep working.
ALTER TABLE service_type ADD COLUMN key TEXT;
UPDATE service_type SET key = 'service_' || id WHERE key IS NULL;
ALTER TABLE service_type ALTER COLUMN key SET NOT NULL;
ALTER TABLE service_type ADD CONSTRAINT service_type_key_unique UNIQUE (key);

ALTER TABLE service_type
  ADD COLUMN accepts_external_users BOOLEAN NOT NULL DEFAULT TRUE;
