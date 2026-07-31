-- Fix duplicate weekly payment rows, then enforce one payment row per nanny
-- per week — and enable realtime for the tracker's live sync.
--
-- Run once in Supabase Dashboard -> SQL Editor. Steps 1-2 must run before
-- step 3 or the unique index creation will fail.

-- 1) Normalize week_end: it should always be week_start + 6 days. Rows
--    written by the old UTC-based code can have week_end one day late.
--    If week_start / week_end are timestamp columns rather than DATE, use
--    `week_start + INTERVAL '6 days'` instead.
UPDATE payments
SET week_end = week_start + 6
WHERE week_end IS DISTINCT FROM week_start + 6;

-- 2) Dedupe: for each (nanny_id, week_start) keep one row — prefer a paid
--    row over an unpaid one, then the highest id (deterministic for uuids).
DELETE FROM payments p
WHERE EXISTS (
  SELECT 1 FROM payments keeper
  WHERE keeper.nanny_id = p.nanny_id
    AND keeper.week_start = p.week_start
    AND keeper.id <> p.id
    AND ( (COALESCE(keeper.is_paid, false) AND NOT COALESCE(p.is_paid, false))
       OR (COALESCE(keeper.is_paid, false) = COALESCE(p.is_paid, false) AND keeper.id > p.id) )
);

-- 3) One payment row per nanny per week, enforced by the database.
CREATE UNIQUE INDEX IF NOT EXISTS one_payment_per_nanny_week
  ON payments (nanny_id, week_start);

-- 4) Realtime: the tracker and dashboard live-update from database changes.
--    Make sure time_entries and payments are in the supabase_realtime
--    publication (Dashboard -> Database -> Replication), or uncomment and
--    run these — skip any table that is already added (re-adding errors):
-- ALTER PUBLICATION supabase_realtime ADD TABLE public.time_entries;
-- ALTER PUBLICATION supabase_realtime ADD TABLE public.payments;
