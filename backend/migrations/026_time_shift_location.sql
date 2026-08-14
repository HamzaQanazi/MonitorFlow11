-- Mandatory clock-in location check (deliberately scoped, I10): a clock-in
-- requires the device to report a valid one-shot location fix, but the
-- coordinate itself is never persisted — only whether one was captured.
-- This is a presence check, not tracking: no lat/lng column, no history,
-- nothing to build a location trail from. See CLAUDE.md §6/§10.
ALTER TABLE time_shift ADD COLUMN location_captured BOOLEAN NOT NULL DEFAULT false;
