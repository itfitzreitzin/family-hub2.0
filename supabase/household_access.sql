-- Household access: only people with a role can see or change anything, and
-- only an admin hands out roles.
--
-- Why. Every read policy so far was `auth.role() = 'authenticated'`, so any
-- account that could sign in — even one that never picked a role — could read
-- the kids' allergies and pickups, the calendars, the care log and the
-- journal. /setup let a new account choose "Family Member" for itself, and
-- nothing in the database stopped a nanny changing her own role (only the
-- Settings page hid the picker).
--
-- After this:
--   • Reading or writing any household table needs a role: family, admin or
--     nanny. An account without one sees nothing and can change nothing.
--   • Only an admin can give out or change a role. A parent can still create
--     a new nanny's profile ("Add a nanny"). Anyone else who signs up waits on
--     the setup screen until an admin lets them in from Settings → Accounts.
--   • Household-only journal entries are hidden from the nanny even when she
--     wrote them, and so are the hearts on them.
--   • The nanny reads only their own calendars and busy times; what they see
--     of the parents' comes through family_calendar.sql's functions.
--   • Everything else keeps the permissions the app already relies on: the
--     nanny clocks herself in and out and logs her own moments; parents run
--     the schedule, the pay and the Care Sheet.
--
-- How to run. Once, in the Supabase SQL editor. It is safe to run again:
-- every policy on these tables is dropped and recreated from this file, and a
-- table that doesn't exist yet is skipped with a notice. The older table
-- files (calendar_tables.sql, care_moments.sql, …) still carry the old
-- open read rules — if you run one of them later, run this file again after.
--
-- Before running, save today's policies in case you want them back:
--   select tablename, policyname, cmd, qual, with_check
--   from pg_policies where schemaname = 'public' order by 1, 2;
--
-- After running, check everyone who should be in has a role:
--   select full_name, role from public.profiles order by role nulls first;
-- The first admin of a brand-new database is set here, by hand:
--   update public.profiles set role = 'admin' where id = '<your user id>';


-- ── 1. Who is asking ─────────────────────────────────────────
-- Policies call these instead of querying profiles directly. They run with
-- the definer's rights (security definer), so the policies on profiles can
-- use them without tripping over their own rules, and the search path is
-- pinned so nothing can shadow the tables they read.

create or replace function public.my_household_role()
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select role from public.profiles where id = auth.uid()
$$;

create or replace function public.is_household_member()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(public.my_household_role() in ('family', 'admin', 'nanny'), false)
$$;

create or replace function public.is_household_parent()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(public.my_household_role() in ('family', 'admin'), false)
$$;

revoke all on function public.my_household_role() from public;
revoke all on function public.is_household_member() from public;
revoke all on function public.is_household_parent() from public;
grant execute on function public.my_household_role() to anon, authenticated, service_role;
grant execute on function public.is_household_member() to anon, authenticated, service_role;
grant execute on function public.is_household_parent() to anon, authenticated, service_role;


-- ── 2. Only an admin hands out roles ─────────────────────────
-- A trigger, not just a policy: it guards the role column whatever the
-- policies allow, and whichever page (or browser console) the write came from.

create or replace function public.guard_profile_role()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  caller text;
begin
  -- No signed-in user: the SQL editor, migrations, the service role.
  if auth.uid() is null then
    return new;
  end if;

  -- Only the role is guarded here; every other column follows the policies.
  if (tg_op = 'INSERT' and new.role is null)
     or (tg_op = 'UPDATE' and new.role is not distinct from old.role) then
    return new;
  end if;

  caller := public.my_household_role();

  if caller = 'admin' then
    return new;
  end if;

  -- A parent adding a nanny: "Add a nanny" creates the new profile.
  if tg_op = 'INSERT' and caller = 'family' and new.role = 'nanny' and new.id <> auth.uid() then
    return new;
  end if;

  -- Someone creating their own profile doesn't pick their role (nor does a
  -- column default): they wait, without one, until an admin lets them in.
  if tg_op = 'INSERT' and new.id = auth.uid() then
    new.role := null;
    return new;
  end if;

  raise exception 'Only an admin can give out or change a role'
    using errcode = '42501',
          hint = 'An admin can let people in from Settings → Accounts.';
end;
$$;

drop trigger if exists guard_profile_role on public.profiles;
create trigger guard_profile_role
  before insert or update on public.profiles
  for each row execute function public.guard_profile_role();


-- ── 3. Members only, table by table ──────────────────────────
-- Each table gets a read rule and a write rule. A FOR ALL write rule also
-- grants reading, so it's only used where everyone it lets write can already
-- read everything (parents, or people writing their own rows).
--
-- reset_policies clears every existing policy on a table (whatever it was
-- called) and turns row-level security on, so what follows is the whole rule
-- set. It returns false for a table that hasn't been created yet, and lives
-- in pg_temp, so it disappears when this session ends.

create or replace function pg_temp.reset_policies(tbl text)
returns boolean
language plpgsql
as $$
declare
  pol record;
begin
  if to_regclass('public.' || tbl) is null then
    raise notice 'Skipping public.%: that table does not exist yet.', tbl;
    return false;
  end if;

  execute format('alter table public.%I enable row level security', tbl);

  for pol in
    select policyname from pg_policies where schemaname = 'public' and tablename = tbl
  loop
    execute format('drop policy %I on public.%I', pol.policyname, tbl);
  end loop;

  return true;
end;
$$;

do $$
begin
  -- People. Everyone reads their own row (so the setup screen can see it is
  -- still waiting); members read everyone. Parents look after nannies'
  -- profiles; the admin looks after all of them.
  if pg_temp.reset_policies('profiles') then
    create policy profiles_select on public.profiles for select
      using (id = auth.uid() or (select public.is_household_member()));

    create policy profiles_insert on public.profiles for insert
      with check (
        id = auth.uid()
        or (select public.my_household_role()) = 'admin'
        or ((select public.is_household_parent()) and role = 'nanny')
      );

    create policy profiles_update on public.profiles for update
      using (
        id = auth.uid()
        or (select public.my_household_role()) = 'admin'
        or ((select public.is_household_parent()) and role = 'nanny')
      )
      with check (
        id = auth.uid()
        or (select public.my_household_role()) = 'admin'
        or ((select public.is_household_parent()) and role = 'nanny')
      );

    create policy profiles_delete on public.profiles for delete
      using (
        (select public.my_household_role()) = 'admin'
        or ((select public.is_household_parent()) and role = 'nanny')
      );
  end if;

  -- Hours. The nanny clocks herself in and out; parents do everything,
  -- including deleting an entry.
  if pg_temp.reset_policies('time_entries') then
    create policy time_entries_select on public.time_entries for select
      using ((select public.is_household_member()));

    create policy time_entries_insert on public.time_entries for insert
      with check (
        (nanny_id = auth.uid() and (select public.is_household_member()))
        or (select public.is_household_parent())
      );

    create policy time_entries_update on public.time_entries for update
      using (
        (nanny_id = auth.uid() and (select public.is_household_member()))
        or (select public.is_household_parent())
      )
      with check (
        (nanny_id = auth.uid() and (select public.is_household_member()))
        or (select public.is_household_parent())
      );

    create policy time_entries_delete on public.time_entries for delete
      using ((select public.is_household_parent()));
  end if;

  -- Pay records. The nanny sees them; only parents write them.
  if pg_temp.reset_policies('payments') then
    create policy payments_select on public.payments for select
      using ((select public.is_household_member()));
    create policy payments_write on public.payments for all
      using ((select public.is_household_parent()))
      with check ((select public.is_household_parent()));
  end if;

  -- The schedule and its repeating series. Read by all, run by parents.
  if pg_temp.reset_policies('schedules') then
    create policy schedules_select on public.schedules for select
      using ((select public.is_household_member()));
    create policy schedules_write on public.schedules for all
      using ((select public.is_household_parent()))
      with check ((select public.is_household_parent()));
  end if;

  if pg_temp.reset_policies('shift_templates') then
    create policy shift_templates_select on public.shift_templates for select
      using ((select public.is_household_member()));
    create policy shift_templates_write on public.shift_templates for all
      using ((select public.is_household_parent()))
      with check ((select public.is_household_parent()));
  end if;

  -- Calendars and busy time. Each person keeps their own; parents can manage
  -- anyone's (the calendar manager edits a partner's or the nanny's). The
  -- nanny reads only their own: what they see of the parents' calendars
  -- comes through family_calendar.sql's household_busy(), which follows
  -- each calendar's nanny_sees setting.
  if pg_temp.reset_policies('parent_calendars') then
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
  end if;

  if pg_temp.reset_policies('calendar_events') then
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
  end if;

  if pg_temp.reset_policies('manual_busy_times') then
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
  end if;

  -- The household roster and the Care Sheet: read by all, kept by parents.
  if pg_temp.reset_policies('family_members') then
    create policy family_members_select on public.family_members for select
      using ((select public.is_household_member()));
    create policy family_members_write on public.family_members for all
      using ((select public.is_household_parent()))
      with check ((select public.is_household_parent()));
  end if;

  if pg_temp.reset_policies('care_sheet') then
    create policy care_sheet_select on public.care_sheet for select
      using ((select public.is_household_member()));
    create policy care_sheet_write on public.care_sheet for all
      using ((select public.is_household_parent()))
      with check ((select public.is_household_parent()));
  end if;

  -- The Care Day log: whoever logged a moment can fix it; parents can fix any.
  if pg_temp.reset_policies('care_moments') then
    create policy care_moments_select on public.care_moments for select
      using ((select public.is_household_member()));
    create policy care_moments_write on public.care_moments for all
      using (
        (author_id = auth.uid() and (select public.is_household_member()))
        or (select public.is_household_parent())
      )
      with check (
        (author_id = auth.uid() and (select public.is_household_member()))
        or (select public.is_household_parent())
      );
  end if;

  -- The Chronicle. Household-only entries are for parents' eyes, whoever
  -- wrote them. Writes get one policy per command rather than FOR ALL: a
  -- FOR ALL policy also grants reading, which would hand the author back
  -- their own household-only entry.
  if pg_temp.reset_policies('chronicle_entries') then
    create policy chronicle_entries_select on public.chronicle_entries for select
      using (
        (select public.is_household_member())
        and (not household_only or (select public.is_household_parent()))
      );
    create policy chronicle_entries_insert on public.chronicle_entries for insert
      with check (
        (author_id = auth.uid() and (select public.is_household_member()))
        or (select public.is_household_parent())
      );
    create policy chronicle_entries_update on public.chronicle_entries for update
      using (
        (author_id = auth.uid() and (select public.is_household_member()))
        or (select public.is_household_parent())
      )
      with check (
        (author_id = auth.uid() and (select public.is_household_member()))
        or (select public.is_household_parent())
      );
    create policy chronicle_entries_delete on public.chronicle_entries for delete
      using (
        (author_id = auth.uid() and (select public.is_household_member()))
        or (select public.is_household_parent())
      );
  end if;

  -- Hearts and Seen receipts: visible only where their entry is, and each
  -- person writes only their own (per command, for the same reason).
  if pg_temp.reset_policies('chronicle_reacts') then
    create policy chronicle_reacts_select on public.chronicle_reacts for select
      using (
        (select public.is_household_member())
        and exists (select 1 from public.chronicle_entries e where e.id = chronicle_reacts.entry_id)
      );
    create policy chronicle_reacts_insert on public.chronicle_reacts for insert
      with check (user_id = auth.uid() and (select public.is_household_member()));
    create policy chronicle_reacts_update on public.chronicle_reacts for update
      using (user_id = auth.uid() and (select public.is_household_member()))
      with check (user_id = auth.uid() and (select public.is_household_member()));
    create policy chronicle_reacts_delete on public.chronicle_reacts for delete
      using (user_id = auth.uid() and (select public.is_household_member()));
  end if;

  -- Legacy tables the app no longer uses (supabase/schedule.sql), closed the
  -- same way in case they exist.
  if pg_temp.reset_policies('availability') then
    create policy availability_select on public.availability for select
      using ((select public.is_household_member()));
    create policy availability_write on public.availability for all
      using ((select public.is_household_parent()))
      with check ((select public.is_household_parent()));
  end if;

  if pg_temp.reset_policies('schedule_blocks') then
    create policy schedule_blocks_select on public.schedule_blocks for select
      using ((select public.is_household_member()));
    create policy schedule_blocks_write on public.schedule_blocks for all
      using ((select public.is_household_parent()))
      with check ((select public.is_household_parent()));
  end if;
end;
$$;
