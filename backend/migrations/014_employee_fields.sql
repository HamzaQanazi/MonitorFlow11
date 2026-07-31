-- Extended Add Employee fields + the generated-login-email scheme (replaces
-- the 4-digit number for employees created through the extended form; see
-- lib/employeeEmail.js). first_name/last_name are additive — `name` stays and
-- is computed from them at write time, since it's read elsewhere (task
-- requester display, audit, etc.) and isn't this task's scope to remove.
ALTER TABLE users
  ADD COLUMN first_name  TEXT,
  ADD COLUMN last_name   TEXT,
  ADD COLUMN birthdate   DATE,
  ADD COLUMN gender      TEXT,       -- machine key ('male'/'female'), i18n-translated client-side like `priority`
  ADD COLUMN worker_type TEXT;       -- machine key ('full_time'/'part_time'/'contractor'), same treatment

-- Step 5 (Branding) of the onboarding wizard: the domain suffix for
-- generated employee login emails (e.g. 'ha.qanazi@' || email_domain).
ALTER TABLE company ADD COLUMN email_domain TEXT;
