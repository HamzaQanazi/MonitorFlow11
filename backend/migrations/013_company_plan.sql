-- Step 7: plan tier selection (wizard addition). Record-only for now — like
-- the step-4 feature selections (012), this captures the owner's pick with no
-- server-side enforcement of its employee cap or feature-group limits; that is
-- a future increment, not this one.
ALTER TABLE company ADD COLUMN plan TEXT; -- plan key ('starter' | 'growth' | 'enterprise')
