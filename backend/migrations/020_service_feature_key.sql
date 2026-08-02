-- Forms & Checklists: a generic tag identifying which onboarding feature
-- module a service belongs to (values come from FEATURE_KEYS in
-- lib/onboardingOptions.js, e.g. 'time_off', 'forms_checklists'). Nullable —
-- most services aren't tied to a feature module. Lets mobile self-service
-- screens (Time Off, Checklists, ...) tell services apart by something other
-- than accepts_employee_submitters alone, which multiple services can share.
ALTER TABLE service_type ADD COLUMN feature_key TEXT;

-- Backfill the live Time Off service so its mobile screen's tightened filter
-- (feature_key = 'time_off') keeps matching it. No-op on any database where
-- this key doesn't exist.
UPDATE service_type SET feature_key = 'time_off' WHERE key = 'time_off_2';
