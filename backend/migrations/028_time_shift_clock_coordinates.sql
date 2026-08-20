-- Re-scope of 026_time_shift_location.sql's "no lat/lng column, deliberately"
-- (CLAUDE.md I10) — a deliberate, explicit decision (not a quiet extension)
-- to let a shift's in-charge manager view where a clock-in/clock-out
-- happened. Still a single point captured at the moment of the action, not
-- a stream: no history table, no polling endpoint, no geofencing/proximity
-- check anywhere in this app — an employee off-site is never blocked.
--
-- clock_in_* stays paired with the existing mandatory `location_captured`
-- flag (clock-in still requires a device fix to succeed). clock_out_* is
-- best-effort: a field employee can always clock out even if no fix is
-- available, so these two columns are the only record of whether one was
-- captured — null just means "not captured", not an error.
ALTER TABLE time_shift ADD COLUMN clock_in_lat double precision;
ALTER TABLE time_shift ADD COLUMN clock_in_lng double precision;
ALTER TABLE time_shift ADD COLUMN clock_out_lat double precision;
ALTER TABLE time_shift ADD COLUMN clock_out_lng double precision;
