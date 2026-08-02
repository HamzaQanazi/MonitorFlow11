-- Knowledge Base feature module (`knowledge_base` onboarding key). Flat list
-- of company articles — no categories, no versioning, no draft/publish state
-- (ponytail: add a category column later only if the article count actually
-- gets unwieldy). title/body are bilingual JSONB (I5), same CHECK convention
-- as shift_template (018_schedule.sql).

CREATE TABLE kb_article (
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
CREATE INDEX idx_kb_article_company ON kb_article(company_id);
