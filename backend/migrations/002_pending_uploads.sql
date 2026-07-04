-- Photo two-step contract (Section 7): a user uploads before the request
-- exists, so an attachment may temporarily have no parent. POST /requests
-- links it (sets request_id) in the same transaction that creates the
-- request. Both parents at once is still forbidden.
ALTER TABLE file_attachment DROP CONSTRAINT file_attachment_check;
ALTER TABLE file_attachment ADD CONSTRAINT file_attachment_single_parent
  CHECK (NOT (request_id IS NOT NULL AND task_id IS NOT NULL));
