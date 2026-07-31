-- Fix for "Error clocking out: JSON object requested, multiple (or no) rows returned"
--
-- Run this once in Supabase Dashboard -> SQL Editor.
-- Step 1 removes existing duplicate open shifts (this alone un-sticks a
-- stuck Clock Out button). Step 2 makes duplicates impossible from then on,
-- and must run after step 1 or the index creation will fail.

-- 1) One-off cleanup: for each nanny, keep only the newest open shift
--    (the one the tracker timer displays) and delete older open duplicates.
DELETE FROM time_entries t
WHERE t.clock_out IS NULL
  AND EXISTS (
    SELECT 1 FROM time_entries newer
    WHERE newer.nanny_id = t.nanny_id
      AND newer.clock_out IS NULL
      AND (newer.clock_in > t.clock_in
           OR (newer.clock_in = t.clock_in AND newer.id > t.id))
  );

-- 2) Guarantee at most one open shift per nanny, enforced by the database.
CREATE UNIQUE INDEX IF NOT EXISTS one_open_shift_per_nanny
  ON time_entries (nanny_id)
  WHERE clock_out IS NULL;
