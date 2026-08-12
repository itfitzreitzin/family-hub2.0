-- QA fix (Aug 2026): cross-member calendar and busy-time writes.
--
-- The August QA pass found that family/admin accounts could not toggle,
-- edit, or delete another member's calendars, and could not add busy times
-- on a nanny's behalf — the deployed database still has the original
-- own-row-only policies ("auth.uid() = user_id") on the calendar tables.
-- The repo's calendar_tables.sql was later widened to let family/admin
-- manage any member's rows, but that version was never applied.
--
-- This file re-applies just those policies. It is idempotent (drop + create)
-- and safe to run more than once. Run it in the Supabase Dashboard ->
-- SQL editor.
--
-- While you're there, the QA pass also surfaced a console warning that
-- 'public.care_moments' is missing from the schema cache: the dashboard's
-- live card needs supabase/care_moments.sql (which itself needs
-- family_members.sql first) — run those too if you haven't.

-- RLS Policies for parent_calendars
drop policy if exists parent_calendars_select on public.parent_calendars;
create policy parent_calendars_select on public.parent_calendars
  for select using (auth.role() = 'authenticated');

drop policy if exists parent_calendars_modify on public.parent_calendars;
create policy parent_calendars_modify on public.parent_calendars
  for all using (
    auth.uid() = user_id
    or exists (
      select 1 from public.profiles p where p.id = auth.uid() and p.role in ('family', 'admin')
    )
  ) with check (
    auth.uid() = user_id
    or exists (
      select 1 from public.profiles p where p.id = auth.uid() and p.role in ('family', 'admin')
    )
  );

-- RLS Policies for calendar_events
drop policy if exists calendar_events_select on public.calendar_events;
create policy calendar_events_select on public.calendar_events
  for select using (auth.role() = 'authenticated');

drop policy if exists calendar_events_modify on public.calendar_events;
create policy calendar_events_modify on public.calendar_events
  for all using (
    auth.uid() = user_id
    or exists (
      select 1 from public.profiles p where p.id = auth.uid() and p.role in ('family', 'admin')
    )
  ) with check (
    auth.uid() = user_id
    or exists (
      select 1 from public.profiles p where p.id = auth.uid() and p.role in ('family', 'admin')
    )
  );

-- RLS Policies for manual_busy_times
drop policy if exists manual_busy_times_select on public.manual_busy_times;
create policy manual_busy_times_select on public.manual_busy_times
  for select using (auth.role() = 'authenticated');

drop policy if exists manual_busy_times_modify on public.manual_busy_times;
create policy manual_busy_times_modify on public.manual_busy_times
  for all using (
    auth.uid() = user_id
    or exists (
      select 1 from public.profiles p where p.id = auth.uid() and p.role in ('family', 'admin')
    )
  ) with check (
    auth.uid() = user_id
    or exists (
      select 1 from public.profiles p where p.id = auth.uid() and p.role in ('family', 'admin')
    )
  );
