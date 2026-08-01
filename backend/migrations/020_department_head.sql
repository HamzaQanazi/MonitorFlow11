-- Owner-facing department management: create/rename/delete a department, and
-- track who heads it. head_user_id is metadata (who to show as "head" and who
-- to fall back to on reassignment/auto-promotion) — it does not itself grant
-- authority; the real Gate-2 effect is that a department's other members get
-- manager_id = head_user_id, same mechanism as any other report.
ALTER TABLE department ADD COLUMN head_user_id INTEGER REFERENCES users(id);
