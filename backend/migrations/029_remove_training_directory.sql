-- Removes the Training & Onboarding and Directory feature modules
-- (supervisor decision, 2026-08-21 — CLAUDE.md §13: low product/thesis value
-- relative to effort). Directory had no dedicated schema (a plain query over
-- `users`), so only Training's tables need dropping. `manage_training` also
-- leaves the Gate-1 capability catalogue (lib/capabilities.js) — remove any
-- grants before the key itself, or the FK on level_capability blocks it.
DELETE FROM level_capability WHERE capability_key = 'manage_training';
DELETE FROM capability WHERE key = 'manage_training';

DROP TABLE IF EXISTS training_completion;
DROP TABLE IF EXISTS training_module;
