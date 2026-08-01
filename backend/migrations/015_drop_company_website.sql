-- Step 5's website field turned out unused beyond storage — nothing in the
-- app ever reads company.website. Dropping it rather than carrying a dead
-- column (CLAUDE.md §6/§9).
ALTER TABLE company DROP COLUMN website;
