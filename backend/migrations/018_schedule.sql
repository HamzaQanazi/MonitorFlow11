-- Schedule feature module (`schedule` onboarding key). Replaces
-- employee_default_shift's single fixed weekly baseline (017_time_clock.sql)
-- with a real forward-looking roster: a manager assigns a named shift_template
-- to a subtree employee for a specific date (schedule_entry). Flat, date-by-date
-- grid — no recurrence engine (ponytail: add recurring patterns/exceptions if
-- re-filling a week by hand becomes the actual bottleneck).
--
-- Time Clock's late/absent/overtime math (lib/timeClock.js) now reads the
-- day's actual schedule_entry instead of a static per-employee weekday
-- pattern, so employee_default_shift is dropped.

CREATE TABLE shift_template (
  id         SERIAL PRIMARY KEY,
  company_id INTEGER NOT NULL REFERENCES company(id),
  name       JSONB NOT NULL,
  start_time TIME NOT NULL,
  end_time   TIME NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (name ? 'en' AND name ? 'ar')
);
CREATE INDEX idx_shift_template_company ON shift_template(company_id);

CREATE TABLE schedule_entry (
  id                SERIAL PRIMARY KEY,
  employee_id       INTEGER NOT NULL REFERENCES users(id),
  company_id        INTEGER NOT NULL REFERENCES company(id),
  date              DATE NOT NULL,
  shift_template_id INTEGER NOT NULL REFERENCES shift_template(id),
  created_by        INTEGER NOT NULL REFERENCES users(id),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (employee_id, date)
);
CREATE INDEX idx_schedule_entry_company_date ON schedule_entry(company_id, date);

DROP TABLE employee_default_shift;
