-- Self-service password reset (CLAUDE.md §13 re-scope, deliberate —
-- supervisor-directed, was previously on the "deliberately NOT built" list).
-- One active token per user in practice: /auth/forgot-password deletes any
-- prior row for that user before inserting a new one. The token itself is
-- never stored, only its sha256 hash (lib/mailer.js emails the raw token as
-- part of the reset link) — a leaked row can't be replayed as a working link.
CREATE TABLE password_reset_token (
  id         SERIAL PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  used_at    TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_password_reset_token_hash ON password_reset_token(token_hash);
