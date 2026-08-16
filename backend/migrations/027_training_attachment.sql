-- "Cheap version" of a more versatile Training module (CLAUDE.md §11): one
-- optional file attachment (PDF or image, existing 5MB/magic-byte allowlist —
-- no new upload path) per module, alongside its bilingual title/body. Same
-- shape as company.logo_file_id — a single nullable FK from the owning row
-- to file_attachment, not a second parent column on file_attachment itself,
-- since a module has at most one attachment (unlike time_entry's photo/note/
-- tip fan-out, 017_time_clock.sql).
ALTER TABLE training_module ADD COLUMN attachment_file_id UUID REFERENCES file_attachment(id);
