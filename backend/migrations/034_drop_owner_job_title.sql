-- Re-scoped, user-directed: owner_job_title (012) was required bilingual data
-- collected at onboarding and round-tripped into Settings, but never actually
-- displayed anywhere (not the wordmark, not mobile, no directory screen — the
-- "future pickers" this was meant for was likely the Directory module, which
-- was itself removed 2026-08-21). Dropped as unused collection with no payoff.
ALTER TABLE company DROP COLUMN owner_job_title;
