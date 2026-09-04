-- Re-scoped, user-directed: sub_industry (012) was collected by the onboarding
-- wizard and shown back in Settings, but nothing ever read it to make a
-- decision (I1 - industry itself is classification data only, same as this
-- was). Dropped as unused collection with no payoff.
ALTER TABLE company DROP COLUMN sub_industry;
