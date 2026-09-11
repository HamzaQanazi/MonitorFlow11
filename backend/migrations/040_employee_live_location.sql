-- Live employee location while clocked in (CLAUDE.md I10 re-scope,
-- user-directed, 2026-09-11 — a deliberate, explicit exception, not a quiet
-- extension of the clock-in/out coordinate columns). Scope, agreed up front:
--   * tracked only while an employee has an active Time Clock shift — no
--     tracking off-shift, ever;
--   * current position ONLY — each ping overwrites these three columns, so
--     there is no location-history table and nothing to query "where was X
--     at 2pm yesterday";
--   * cleared back to NULL the moment a shift ends (clock-out), so no
--     last-known position lingers after the shift is over.
-- Gated by the new view_live_location capability (lib/capabilities.js),
-- separate from view_all so it can be granted more narrowly.
ALTER TABLE time_shift ADD COLUMN live_lat double precision;
ALTER TABLE time_shift ADD COLUMN live_lng double precision;
ALTER TABLE time_shift ADD COLUMN live_location_at TIMESTAMPTZ;

-- seed.js already inserts from lib/capabilities.js's CAPABILITIES array on a
-- fresh TRUNCATE-and-reseed; this is for an already-provisioned database.
INSERT INTO capability (key) VALUES
  ('view_live_location')
ON CONFLICT (key) DO NOTHING;
