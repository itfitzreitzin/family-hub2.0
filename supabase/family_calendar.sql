-- The family calendar: the household's Google calendars on Home, and the
-- nanny's view of when the parents are busy.
--
-- Each parent connects their own Google calendar (and the family's shared
-- one) through its private iCal address, the way the old shift planner did.
-- Three new settings on each connected calendar decide where it shows:
--
--   show_on_home  its events appear on Home — the Today card and Home →
--                 Calendar. Calendars connected in the old planner start
--                 hidden; switch on the ones you want.
--   is_family     it's the household's calendar rather than one parent's:
--                 its events say "Family" and never make a parent look busy.
--   nanny_sees    what the nanny sees of it:
--                   'nothing'  (the default)
--                   'busy'     when you're busy — times only, never what
--                   'details'  the events themselves
--
-- calendar_events.all_day is set by the sync from the feed, so all-day
-- events (birthdays, holidays, "no school") show as all-day.
--
-- Who reads what, after this:
--   • Parents read every calendar and every event, as before.
--   • The nanny reads only their own calendars and events. Until now every
--     member could read every calendar's events and its secret iCal address
--     (the schedule page just didn't show them), and anyone could file an
--     event under someone else's calendar.
--   • What the nanny sees of the parents comes only through the two
--     functions below, which follow each calendar's nanny_sees.
--
-- Run once in Supabase Dashboard -> SQL Editor, after household_access.sql
-- (it uses that file's is_household_member / is_household_parent helpers).
-- Safe to run again. household_access.sql carries the same read rules, so
-- running that one again later doesn't reopen the calendars.


-- ── 1. The new settings ──────────────────────────────────────

alter table public.parent_calendars
  add column if not exists show_on_home boolean not null default false,
  add column if not exists is_family boolean not null default false,
  add column if not exists nanny_sees text not null default 'nothing'
    check (nanny_sees in ('nothing', 'busy', 'details'));

alter table public.calendar_events
  add column if not exists all_day boolean not null default false;

comment on column public.parent_calendars.show_on_home is
  'Its events appear on Home (the Today card and Home -> Calendar).';
comment on column public.parent_calendars.is_family is
  'The household''s shared calendar rather than one parent''s.';
comment on column public.parent_calendars.nanny_sees is
  'What the nanny sees of it: nothing, busy (times only) or details (the events).';
comment on column public.calendar_events.all_day is
  'An all-day event in the feed; set by the sync.';


-- ── 2. The nanny reads only their own calendars ──────────────
-- Every policy on these tables is dropped and recreated, whatever it was
-- called (calendar_tables.sql and household_access.sql named them
-- differently), so what follows is the whole rule set.

create or replace function pg_temp.reset_calendar_policies(tbl text)
returns void
language plpgsql
as $$
declare
  pol record;
begin
  execute format('alter table public.%I enable row level security', tbl);
  for pol in
    select policyname from pg_policies where schemaname = 'public' and tablename = tbl
  loop
    execute format('drop policy %I on public.%I', pol.policyname, tbl);
  end loop;
end;
$$;

select pg_temp.reset_calendar_policies('parent_calendars');

create policy parent_calendars_select on public.parent_calendars for select
  using (
    (select public.is_household_parent())
    or (user_id = auth.uid() and (select public.is_household_member()))
  );
create policy parent_calendars_write on public.parent_calendars for all
  using (
    (user_id = auth.uid() and (select public.is_household_member()))
    or (select public.is_household_parent())
  )
  with check (
    (user_id = auth.uid() and (select public.is_household_member()))
    or (select public.is_household_parent())
  );

select pg_temp.reset_calendar_policies('calendar_events');

create policy calendar_events_select on public.calendar_events for select
  using (
    (select public.is_household_parent())
    or (user_id = auth.uid() and (select public.is_household_member()))
  );
-- The nanny files events only under their own calendars.
create policy calendar_events_write on public.calendar_events for all
  using (
    (user_id = auth.uid() and (select public.is_household_member()))
    or (select public.is_household_parent())
  )
  with check (
    (select public.is_household_parent())
    or (
      user_id = auth.uid()
      and (select public.is_household_member())
      and exists (
        select 1 from public.parent_calendars c
        where c.id = calendar_events.calendar_id and c.user_id = auth.uid()
      )
    )
  );

select pg_temp.reset_calendar_policies('manual_busy_times');

create policy manual_busy_times_select on public.manual_busy_times for select
  using (
    (select public.is_household_parent())
    or (user_id = auth.uid() and (select public.is_household_member()))
  );
create policy manual_busy_times_write on public.manual_busy_times for all
  using (
    (user_id = auth.uid() and (select public.is_household_member()))
    or (select public.is_household_parent())
  )
  with check (
    (user_id = auth.uid() and (select public.is_household_member()))
    or (select public.is_household_parent())
  );


-- ── 3. What the nanny may see of the parents' calendars ──────
-- Both run with the definer's rights, so they can read past the rules
-- above, and return only what each calendar's nanny_sees allows. Only
-- parents' calendars are shared this way, and only to household members.

-- The calendars shared with the nanny, so their page can tell "free all
-- day" from "not shared", and how fresh the picture is. No names, no
-- addresses.
create or replace function public.household_shared_calendars()
returns table (
  calendar_id bigint,
  owner_id uuid,
  is_family boolean,
  nanny_sees text,
  last_synced timestamp with time zone
)
language sql
stable
security definer
set search_path = ''
as $$
  select c.id, c.user_id, c.is_family, c.nanny_sees, c.last_synced
  from public.parent_calendars c
  join public.profiles p on p.id = c.user_id and p.role in ('family', 'admin')
  where (select public.is_household_member())
    and c.nanny_sees in ('busy', 'details')
  order by c.id
$$;

-- Their events overlapping [range_start, range_end). A calendar shared as
-- 'busy' gives only its busy events' times; one shared as 'details' gives
-- every event with its title, and whether Google counts it as busy.
-- (Dropped first so a re-run can change what it returns.)
drop function if exists public.household_busy(timestamp with time zone, timestamp with time zone);
create function public.household_busy(
  range_start timestamp with time zone,
  range_end timestamp with time zone
)
returns table (
  event_id bigint,
  calendar_id bigint,
  owner_id uuid,
  is_family boolean,
  title text,
  starts_at timestamp with time zone,
  ends_at timestamp with time zone,
  all_day boolean,
  is_busy boolean
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    e.id,
    c.id,
    c.user_id,
    c.is_family,
    case when c.nanny_sees = 'details' then e.title end,
    e.start_time,
    e.end_time,
    e.all_day,
    coalesce(e.is_busy, true)
  from public.calendar_events e
  join public.parent_calendars c on c.id = e.calendar_id
  join public.profiles p on p.id = c.user_id and p.role in ('family', 'admin')
  where (select public.is_household_member())
    and (c.nanny_sees = 'details' or (c.nanny_sees = 'busy' and coalesce(e.is_busy, true)))
    and e.start_time < range_end
    and e.end_time > range_start
  order by e.start_time
$$;

-- Supabase grants new functions to anon by default, so take that back too:
-- signed-out visitors get nothing either way, but needn't be able to ask.
revoke all on function public.household_shared_calendars() from public, anon;
revoke all on function public.household_busy(timestamp with time zone, timestamp with time zone)
  from public, anon;
grant execute on function public.household_shared_calendars() to authenticated, service_role;
grant execute on function public.household_busy(timestamp with time zone, timestamp with time zone)
  to authenticated, service_role;
