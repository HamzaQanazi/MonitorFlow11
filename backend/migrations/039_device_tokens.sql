-- Push notification device tokens (CLAUDE.md §13, FCM exception, 2026-09-10).
-- One row per physical device's current FCM token. `token` alone is UNIQUE
-- (not per-user) because a token identifies a device/app-install, not a
-- person: if a different user logs into the same phone, POST /devices
-- upserts this row onto the new user_id instead of creating a duplicate
-- pointed at the same device. `platform` is Android-only for now (no APNs
-- key configured yet) but the column exists so iOS is just a new value, not
-- a new table, when that's added.
CREATE TABLE device_token (
  id SERIAL PRIMARY KEY,
  user_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token TEXT NOT NULL UNIQUE,
  platform TEXT NOT NULL DEFAULT 'android',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX device_token_user_idx ON device_token (user_id);
