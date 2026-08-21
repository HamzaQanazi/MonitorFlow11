-- One fixed day off per week per employee (0=Sunday..6=Saturday, JS
-- Date#getUTCDay() convention — same as schedule.js's weekday filter).
-- Scoped deliberately small: a single static rest day, not a general
-- availability/preference system (CLAUDE.md §13's AI-suggested scheduling
-- entry) — lets /schedule/suggest skip an employee on their day off when a
-- company's working week (picked per-suggestion) is wider than what that
-- employee is contracted for, e.g. a 6-day company week with 5-day staff.
ALTER TABLE users
  ADD COLUMN weekly_rest_day SMALLINT CHECK (weekly_rest_day BETWEEN 0 AND 6);
