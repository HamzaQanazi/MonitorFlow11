-- Spec v4 (docs/spec_v4_amendment.md, Section G): admin role, per-service
-- escalation thresholds, account/configuration audit log.

ALTER TABLE users DROP CONSTRAINT users_role_check;
ALTER TABLE users ADD CONSTRAINT users_role_check
  CHECK (role IN ('user', 'employee', 'monitor', 'admin'));

-- NULL = escalation rule off for that service (Section E1; sweep lands W5).
ALTER TABLE service_type
  ADD COLUMN escalate_unassigned_hours INTEGER,
  ADD COLUMN escalate_stale_hours      INTEGER,
  ADD COLUMN escalate_confirm_hours    INTEGER;

-- Account/configuration events only — request lifecycle stays in
-- request_status_history (Section C).
CREATE TABLE audit_event (
  id          SERIAL PRIMARY KEY,
  actor_id    INTEGER NOT NULL REFERENCES users(id),
  action      TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id   INTEGER NOT NULL,
  detail      JSONB,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_audit_created ON audit_event(created_at);
