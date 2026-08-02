-- Extends the fixed Gate-1 capability catalogue with per-module authoring
-- keys (Levels & Capabilities live editor): a level can now be granted just
-- manage_events / manage_knowledge_base / manage_training without also
-- holding view_all — e.g. an "HR" role that authors Training content but has
-- no operational oversight of the request/task queue. seed.js already
-- inserts from lib/capabilities.js's CAPABILITIES array on a fresh
-- TRUNCATE-and-reseed; this migration is for an already-provisioned database
-- that won't be reseeded.
INSERT INTO capability (key) VALUES
  ('manage_events'),
  ('manage_knowledge_base'),
  ('manage_training')
ON CONFLICT (key) DO NOTHING;
