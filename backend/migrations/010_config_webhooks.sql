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

-- Outbound webhook subscriptions (admin-managed, spec v-Phase7). A subscriber
-- registers a URL + shared secret and the events it wants; the dispatcher POSTs
-- a signed payload after commit. `secret` signs the body (HMAC-SHA256) — it is
-- never returned after creation.
CREATE TABLE webhook_subscription (
  id         SERIAL PRIMARY KEY,
  url        TEXT NOT NULL,
  secret     TEXT NOT NULL,
  events     TEXT[] NOT NULL,   -- subset of request_created/status_changed/assigned/sla_breached
  is_active  BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_webhook_active ON webhook_subscription(is_active);
