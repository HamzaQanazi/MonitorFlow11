-- Pivot (v7): single company per deployment + first-login onboarding wizard.
--
-- The buyer is provisioned an Owner account (role 'admin') at purchase time
-- (seed.js). On first login the client sees company.onboarding_completed = false
-- and runs the "Customize your app in 1 minute" wizard, which fills in the one
-- company row, its branches, and its selected features, then flips the flag.
--
-- Single-org per deployment (unchanged invariant): there is at most ONE company
-- row. It is a table rather than a singleton config so branches/features get
-- clean foreign keys and the model can grow to multi-tenant later without a
-- rewrite.

CREATE TABLE company (
  id                  SERIAL PRIMARY KEY,
  -- Owner-entered tenant data (the owner types these once), so plain TEXT, not
  -- the bilingual {en,ar} used for SYSTEM labels (I5 is about system labels).
  name                TEXT,
  address             TEXT,
  owner_job_title     TEXT,          -- step 1: the registrant's role
  employee_range      TEXT,          -- step 2: '1-5' | '6-10' | '11-30' | ...
  industry            TEXT,          -- step 2: industry key
  sub_industry        TEXT,          -- step 2: sub-industry key (depends on industry)
  features            TEXT[] NOT NULL DEFAULT '{}',  -- step 4: selected feature keys
  logo_file_id        UUID REFERENCES file_attachment(id) ON DELETE SET NULL, -- step 5
  website             TEXT,          -- step 5
  phone               TEXT,          -- step 6
  onboarding_completed BOOLEAN NOT NULL DEFAULT FALSE,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Step 3: one row per branch the owner names.
CREATE TABLE branch (
  id         SERIAL PRIMARY KEY,
  company_id INTEGER NOT NULL REFERENCES company(id) ON DELETE CASCADE,
  name       TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_branch_company ON branch(company_id);

-- Which company an account belongs to. Nullable so pre-pivot rows and the
-- provisioning flow (Owner created before the company row) stay valid.
ALTER TABLE users ADD COLUMN company_id INTEGER REFERENCES company(id) ON DELETE SET NULL;
