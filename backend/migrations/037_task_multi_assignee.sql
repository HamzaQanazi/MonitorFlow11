-- User-directed re-scope: a request may now have more than one assigned
-- employee (a "team" of solo tasks, not a multi-person task). Each task row
-- stays exactly as solo as it always was -- one row, one employee_id, its own
-- completion form, its own accept/reject -- only the request-level
-- constraint changes: from "at most one task row per request" to "at most
-- one task row per (request, employee) pair", so several employees can each
-- hold their own task on the same request.
--
-- Any of a request's assignees may fire an actor-gated transition (the
-- "either moves it, moves for both" model) -- the workflow engine, request
-- status, and TASK.status stay single-valued per request; only the set of
-- who can act on them widens. No "lead" concept. Enforced in
-- lib/workflowEngine.js and routes/requests.js, not by this migration.
ALTER TABLE task DROP CONSTRAINT task_request_id_key;
ALTER TABLE task ADD CONSTRAINT task_request_employee_key UNIQUE (request_id, employee_id);
