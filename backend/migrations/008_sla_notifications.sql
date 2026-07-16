-- Phase 5 (CLAUDE.md §10): relational notifications + tree SLA.
--
-- 1. Per-status `sla_minutes` (in the workflow JSONB) replaces the three
--    service-level escalation threshold columns from spec v4.
ALTER TABLE service_type
  DROP COLUMN escalate_unassigned_hours,
  DROP COLUMN escalate_stale_hours,
  DROP COLUMN escalate_confirm_hours;

-- 2. Bilingual notification messages (deferred here by Phase 3): message
--    becomes an {en, ar} JSONB object, same CHECK shape as the Phase-3 name
--    columns. Existing English rows carry over as both languages.
ALTER TABLE notification
  ALTER COLUMN message TYPE JSONB USING jsonb_build_object('en', message, 'ar', message);
ALTER TABLE notification
  ADD CONSTRAINT notification_message_bilingual CHECK (message ? 'en' AND message ? 'ar');
