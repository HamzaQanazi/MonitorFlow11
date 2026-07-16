-- Migration 007 — Phase 3: bilingual {en,ar} labels. The three scalar
-- user-facing name columns become JSONB objects carrying both languages, with
-- a CHECK that rejects an English-only (or Arabic-only) label at the DB.
-- Nested labels inside form_definition.field_schema and workflow_definition
-- .statuses stay JSONB and are guarded by the seed-time validators (CLAUDE.md
-- §8 already trusts stored schemas) — a scalar CHECK can't reach array elements
-- cheaply. See lib/i18nLabel.js. Existing rows are wrapped en=ar as a
-- placeholder; the reseed writes real Arabic.

ALTER TABLE department
  ALTER COLUMN name TYPE JSONB USING jsonb_build_object('en', name, 'ar', name),
  ADD CONSTRAINT department_name_bilingual CHECK (name ? 'en' AND name ? 'ar');

ALTER TABLE service_type
  ALTER COLUMN name TYPE JSONB USING jsonb_build_object('en', name, 'ar', name),
  ADD CONSTRAINT service_type_name_bilingual CHECK (name ? 'en' AND name ? 'ar');

ALTER TABLE employee_level
  ALTER COLUMN name TYPE JSONB USING jsonb_build_object('en', name, 'ar', name),
  ADD CONSTRAINT employee_level_name_bilingual CHECK (name ? 'en' AND name ? 'ar');
