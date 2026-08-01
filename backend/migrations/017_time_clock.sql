-- Time Clock feature module (CLAUDE.md §1/§9: `time_clock` is a selectable
-- onboarding feature key; this is the first feature module built against
-- that selection). NFC clock-in was scoped out (hardware-dependent, no
-- testable path in this environment) — `source` has no 'nfc' value.
--
-- No live/continuous location tracking (I10) — shifts are timestamps only.
-- "Late"/"absent" need a baseline, and the real Schedule feature (`schedule`
-- onboarding key) isn't built yet; employee_default_shift is a minimal stand-in
-- (one expected start/end + weekdays) just for that computation, not a full
-- shift-pattern engine.

CREATE TABLE time_shift (
  id              SERIAL PRIMARY KEY,
  employee_id     INTEGER NOT NULL REFERENCES users(id),
  company_id      INTEGER NOT NULL REFERENCES company(id),
  clock_in_at     TIMESTAMPTZ NOT NULL,
  clock_out_at    TIMESTAMPTZ,
  source          TEXT NOT NULL CHECK (source IN ('clock', 'manual')),
  status          TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'completed')),
  approval_status TEXT NOT NULL DEFAULT 'approved' CHECK (approval_status IN ('pending', 'approved', 'edited')),
  note            TEXT,
  approved_by     INTEGER REFERENCES users(id),
  approved_at     TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (clock_out_at IS NULL OR clock_out_at > clock_in_at)
);

-- Native constraint, not app-level locking: at most one active shift per
-- employee. A concurrent double clock-in hits the unique index, not a race.
CREATE UNIQUE INDEX idx_time_shift_one_active ON time_shift(employee_id) WHERE status = 'active';
CREATE INDEX idx_time_shift_employee_period ON time_shift(employee_id, clock_in_at);
CREATE INDEX idx_time_shift_company_period ON time_shift(company_id, clock_in_at);

CREATE TABLE time_break (
  id             SERIAL PRIMARY KEY,
  shift_id       INTEGER NOT NULL REFERENCES time_shift(id) ON DELETE CASCADE,
  break_start_at TIMESTAMPTZ NOT NULL,
  break_end_at   TIMESTAMPTZ,
  CHECK (break_end_at IS NULL OR break_end_at > break_start_at)
);
CREATE UNIQUE INDEX idx_time_break_one_active ON time_break(shift_id) WHERE break_end_at IS NULL;

-- One log table for the three in-shift extras (note/photo/tip) instead of
-- three near-identical tables. Photos are file_attachment rows that point
-- back here (see below) — a 'photo' entry itself carries no body/amount.
CREATE TABLE time_entry (
  id         SERIAL PRIMARY KEY,
  shift_id   INTEGER NOT NULL REFERENCES time_shift(id) ON DELETE CASCADE,
  type       TEXT NOT NULL CHECK (type IN ('note', 'photo', 'tip')),
  body       TEXT,
  amount     NUMERIC(10, 2),
  created_by INTEGER NOT NULL REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (
    (type = 'note'  AND body IS NOT NULL AND amount IS NULL) OR
    (type = 'tip'   AND amount IS NOT NULL AND amount > 0 AND body IS NULL) OR
    (type = 'photo' AND body IS NULL AND amount IS NULL)
  )
);
CREATE INDEX idx_time_entry_shift ON time_entry(shift_id);

-- file_attachment gains a third possible parent. The existing "at most one of
-- request_id/task_id" check (002_pending_uploads.sql) generalizes to "at most
-- one of the three" — same pending-upload-then-link contract, same shape.
ALTER TABLE file_attachment ADD COLUMN time_entry_id INTEGER REFERENCES time_entry(id);
ALTER TABLE file_attachment DROP CONSTRAINT file_attachment_single_parent;
ALTER TABLE file_attachment ADD CONSTRAINT file_attachment_single_parent CHECK (
  (CASE WHEN request_id IS NOT NULL THEN 1 ELSE 0 END +
   CASE WHEN task_id IS NOT NULL THEN 1 ELSE 0 END +
   CASE WHEN time_entry_id IS NOT NULL THEN 1 ELSE 0 END) <= 1
);

-- Minimal late/absent baseline (see header note). NULL/empty expected_days
-- means "no baseline set" — that employee is excluded from late/absent counts
-- until a manager sets one.
CREATE TABLE employee_default_shift (
  employee_id          INTEGER PRIMARY KEY REFERENCES users(id),
  expected_start_time  TIME,
  expected_end_time    TIME,
  expected_days        SMALLINT[] -- 0=Sunday..6=Saturday, matches Postgres EXTRACT(DOW)
);
