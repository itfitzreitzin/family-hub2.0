-- Track the last sync failure per connected calendar, so the schedule page
-- can show "sync failed" instead of silently displaying stale overlays.
--
-- Run once in Supabase Dashboard -> SQL Editor. The sync endpoint tolerates
-- this column being absent (it retries without it), so deploy order doesn't
-- matter — but the failure badge only works after this runs.

ALTER TABLE public.parent_calendars
  ADD COLUMN IF NOT EXISTS sync_error text;

COMMENT ON COLUMN public.parent_calendars.sync_error IS
  'Message from the most recent failed sync; null after a clean sync.';
