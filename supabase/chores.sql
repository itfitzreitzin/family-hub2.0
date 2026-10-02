-- Chores: what the house needs doing, who's on it, and who did it.
--
-- chores holds one row per chore, in one of three cadences:
--   once   a one-off ("switch the laundry over"), due by due_on or whenever
--          (due_on null). Done once, it's closed: closed_at is stamped by the
--          trigger below, from the completion.
--   weeks  on a schedule: due on due_on's weekday, every `every` weeks
--          (1 = weekly, 2 = every other week), counting from due_on — so
--          due_on also says which weeks recycling goes out. It's due that day
--          whether or not the last one was done (trash day).
--   days   every so often: due `every` days after it was last done (water the
--          plants every 3 days). due_on is the first due date; after that
--          the clock starts over each time it's done.
-- assigned_to is whose it is; null means anyone's.
--
-- chore_completions is the record: one row each time a chore is done, saying
-- which day it counts for, who did it and when. counts_for is the scheduled
-- day it met for a 'weeks' chore (done Thursday for Friday's trash, or
-- Saturday for yesterday's), the due date for a one-off (the day it was made,
-- when it had none), and the day it was done for a 'days' chore. Whoever
-- does it gets the credit, whoever it was assigned to. Streaks and the "who
-- did what this week" tally are read from here, and so will anything that
-- awards points later. One completion per chore per day it counts for: a
-- second phone tapping the same chore is refused, not doubled.
--
-- Removing a chore stamps archived_at rather than deleting it, so what was
-- done stays in the record.
--
-- Who can do what:
--   parents  read and change everything;
--   the nanny sees only the chores assigned to them, marks them done, and
--             can take back their own tick.
--
-- Run once in Supabase Dashboard -> SQL Editor, after household_access.sql
-- (it uses that file's is_household_member / is_household_parent helpers).
-- Safe to run again.

create table if not exists public.chores (
  id bigint generated always as identity primary key,
  title text not null check (length(btrim(title)) between 1 and 80),
  note text check (note is null or length(note) <= 200),
  assigned_to uuid references auth.users(id) on delete set null,
  cadence text not null default 'once' check (cadence in ('once', 'weeks', 'days')),
  every smallint check (every is null or every between 1 and 365),
  due_on date,
  closed_at timestamp with time zone,
  archived_at timestamp with time zone,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamp with time zone not null default now(),
  constraint chores_repeat_shape check (
    cadence = 'once'
    or (every is not null and due_on is not null and (cadence = 'days' or every <= 8))
  )
);

create index if not exists chores_live_idx on public.chores (created_at)
  where archived_at is null;

create table if not exists public.chore_completions (
  id bigint generated always as identity primary key,
  chore_id bigint not null references public.chores(id) on delete cascade,
  counts_for date not null,
  done_by uuid references auth.users(id) on delete set null,
  done_at timestamp with time zone not null default now()
);

create unique index if not exists one_completion_per_chore_day
  on public.chore_completions (chore_id, counts_for);
create index if not exists chore_completions_done_at_idx
  on public.chore_completions (done_at);

-- A one-off is closed by being done, and opens again if the tick is taken
-- back. A trigger rather than the app, because the nanny can tick off a
-- chore but can't change the chore itself.
create or replace function public.chore_completion_closes_once()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  target bigint;
begin
  target := case when tg_op = 'DELETE' then old.chore_id else new.chore_id end;
  update public.chores c
     set closed_at = (
       select max(done_at) from public.chore_completions where chore_id = target
     )
   where c.id = target and c.cadence = 'once';
  return null;
end;
$$;

revoke all on function public.chore_completion_closes_once() from public;

drop trigger if exists chore_completion_closes_once on public.chore_completions;
create trigger chore_completion_closes_once
  after insert or delete on public.chore_completions
  for each row execute function public.chore_completion_closes_once();

-- Chores: parents see and change them all; the nanny sees theirs.
alter table public.chores enable row level security;

drop policy if exists chores_select on public.chores;
create policy chores_select on public.chores for select
  using (
    (select public.is_household_parent())
    or (assigned_to = auth.uid() and (select public.is_household_member()))
  );

drop policy if exists chores_write on public.chores;
create policy chores_write on public.chores for all
  using ((select public.is_household_parent()))
  with check ((select public.is_household_parent()));

-- Completions: parents see and change them all; the nanny sees the record of
-- their own chores, ticks them off as themselves, and takes back their own.
alter table public.chore_completions enable row level security;

drop policy if exists chore_completions_select on public.chore_completions;
create policy chore_completions_select on public.chore_completions for select
  using (
    (select public.is_household_parent())
    or (
      (select public.is_household_member())
      and exists (
        select 1 from public.chores c
        where c.id = chore_id and c.assigned_to = auth.uid()
      )
    )
  );

drop policy if exists chore_completions_insert on public.chore_completions;
create policy chore_completions_insert on public.chore_completions for insert
  with check (
    done_by = auth.uid()
    and (
      (select public.is_household_parent())
      or (
        (select public.is_household_member())
        and exists (
          select 1 from public.chores c
          where c.id = chore_id and c.assigned_to = auth.uid() and c.archived_at is null
        )
      )
    )
  );

drop policy if exists chore_completions_delete on public.chore_completions;
create policy chore_completions_delete on public.chore_completions for delete
  using (
    (select public.is_household_parent())
    or (done_by = auth.uid() and (select public.is_household_member()))
  );

-- Realtime: a tick on one phone shows on the other, and on the kitchen
-- display. Safe to re-run.
do $$
declare
  t text;
begin
  foreach t in array array['chores', 'chore_completions'] loop
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t
    ) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end;
$$;
