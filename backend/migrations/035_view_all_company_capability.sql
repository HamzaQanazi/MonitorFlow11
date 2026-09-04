-- Extends the fixed Gate-1 capability catalogue with view_all_company
-- (user-directed, 2026-09-04): a level holding it gets company-wide Gate-2
-- scope instead of the flat department-only scope every other capability
-- leaves unchanged — see lib/scope.js and lib/capabilities.js. seed.js
-- already inserts from lib/capabilities.js's CAPABILITIES array on a fresh
-- TRUNCATE-and-reseed; this migration is for an already-provisioned database
-- that won't be reseeded.
INSERT INTO capability (key) VALUES
  ('view_all_company')
ON CONFLICT (key) DO NOTHING;
