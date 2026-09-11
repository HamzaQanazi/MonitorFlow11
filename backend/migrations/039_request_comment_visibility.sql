-- Employee chat (user-directed): request_comment gains a visibility split so
-- an internal thread between a request's current assignees and its
-- department's oversight employees can reuse the existing comment machinery
-- instead of a second table. Existing rows are all customer-facing (the
-- user <-> oversight thread, unchanged); default keeps them that way.
ALTER TABLE request_comment
  ADD COLUMN visibility TEXT NOT NULL DEFAULT 'customer'
    CHECK (visibility IN ('customer', 'internal'));
