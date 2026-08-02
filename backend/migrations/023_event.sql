-- Events feature module (`events` onboarding key, communication group).
-- Company calendar: title/description bilingual (I5), description optional
-- (not every event needs a paragraph). RSVP is a plain join table — presence
-- of a row = "I'm attending" (no yes/no/maybe, ponytail: add states if a
-- real need for "maybe" shows up).

CREATE TABLE event (
  id          SERIAL PRIMARY KEY,
  company_id  INTEGER NOT NULL REFERENCES company(id),
  title       JSONB NOT NULL,
  description JSONB,
  starts_at   TIMESTAMPTZ NOT NULL,
  ends_at     TIMESTAMPTZ,
  location    TEXT,
  created_by  INTEGER NOT NULL REFERENCES users(id),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (title ? 'en' AND title ? 'ar'),
  CHECK (description IS NULL OR (description ? 'en' AND description ? 'ar'))
);
CREATE INDEX idx_event_company_starts ON event(company_id, starts_at);

CREATE TABLE event_rsvp (
  event_id     INTEGER NOT NULL REFERENCES event(id) ON DELETE CASCADE,
  user_id      INTEGER NOT NULL REFERENCES users(id),
  responded_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (event_id, user_id)
);
