-- The owner-entered company/branch names show up across the console and
-- mobile apps regardless of the viewer's language (wordmark today; branch
-- pickers are a plausible next consumer) — same rationale as system labels
-- (I5), so these become bilingual JSONB like department/service_type/
-- employee_level did in 007_bilingual.sql. company's three columns are
-- nullable (the row exists pre-onboarding with no values yet); the CHECK
-- passes through NULL unchanged, same as any other nullable column.
ALTER TABLE company
  ALTER COLUMN name TYPE JSONB USING
    CASE WHEN name IS NULL THEN NULL ELSE jsonb_build_object('en', name, 'ar', name) END,
  ADD CONSTRAINT company_name_bilingual CHECK (name ? 'en' AND name ? 'ar'),
  ALTER COLUMN address TYPE JSONB USING
    CASE WHEN address IS NULL THEN NULL ELSE jsonb_build_object('en', address, 'ar', address) END,
  ADD CONSTRAINT company_address_bilingual CHECK (address ? 'en' AND address ? 'ar'),
  ALTER COLUMN owner_job_title TYPE JSONB USING
    CASE WHEN owner_job_title IS NULL THEN NULL ELSE jsonb_build_object('en', owner_job_title, 'ar', owner_job_title) END,
  ADD CONSTRAINT company_owner_job_title_bilingual CHECK (owner_job_title ? 'en' AND owner_job_title ? 'ar');

ALTER TABLE branch
  ALTER COLUMN name TYPE JSONB USING jsonb_build_object('en', name, 'ar', name),
  ADD CONSTRAINT branch_name_bilingual CHECK (name ? 'en' AND name ? 'ar');
