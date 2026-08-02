-- Training & Onboarding feature module (`training_onboarding` onboarding
-- key, hr_skills group). Same shape as Knowledge Base (018_schedule.sql-style
-- bilingual content) plus a completion join table mirroring event_rsvp
-- (023_event.sql) — presence of a row = "this employee finished it."
-- Deliberately a separate table from kb_article: training is assign-and-
-- track, KB is pure reference — mixing them would blur that distinction on
-- both list pages.

CREATE TABLE training_module (
  id         SERIAL PRIMARY KEY,
  company_id INTEGER NOT NULL REFERENCES company(id),
  title      JSONB NOT NULL,
  body       JSONB NOT NULL,
  created_by INTEGER NOT NULL REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (title ? 'en' AND title ? 'ar'),
  CHECK (body ? 'en' AND body ? 'ar')
);
CREATE INDEX idx_training_module_company ON training_module(company_id);

CREATE TABLE training_completion (
  module_id     INTEGER NOT NULL REFERENCES training_module(id) ON DELETE CASCADE,
  user_id       INTEGER NOT NULL REFERENCES users(id),
  completed_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (module_id, user_id)
);
