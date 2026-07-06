-- Spec v4 Section E1: escalation notifications (the sweep's output type).
ALTER TABLE notification DROP CONSTRAINT notification_type_check;
ALTER TABLE notification ADD CONSTRAINT notification_type_check
  CHECK (type IN ('assigned', 'status_changed', 'completed', 'task_rejected', 'comment', 'escalation'));
