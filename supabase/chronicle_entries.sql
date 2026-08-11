-- Chronicle entries: the written layer of the family journal.
--
-- Step 3 of CHRONICLE_CARE_DAY.md introduces the table (morning notes ride
-- it, tagged 'morning'); step 4's shift wrap-ups and step 5's Chronicle
-- page write and read the same rows. An entry is a dated piece of writing —
-- by a parent or drafted from a shift — optionally scoped to kids, tagged
-- (morning / needs / health / milestone / headsup), and markable
-- "household only" so parents can write candidly without nanny visibility.
--
-- chronicle_reacts is the tiny companion table for one-tap
-- acknowledgements: the nanny's "Seen" receipt on a morning note now, the
-- parents' ♥ on entries when the Chronicle page lands. One row per person
-- per entry per kind, writable only by its owner — which is what lets the
-- nanny stamp a receipt on a parent's note without edit rights to it.
--
-- Run once in Supabase Dashboard -> SQL Editor, after family_members.sql.
-- NOTE: shift_id assumes time_entries.id is uuid (the shipped table's key
-- type); if your time_entries uses a bigint key, change the column type to
-- match before running.

create table if not exists public.chronicle_entries (
  id bigint generated always as identity primary key,
  author_id uuid references auth.users(id) on delete set null,
  shift_id uuid references public.time_entries(id) on delete set null,
  kid_ids uuid[] not null default '{}',
  entry_date date not null,
  body text not null,
  tags text[] not null default '{}',
  household_only boolean not null default false,
  photo_url text,               -- reserved for the Supabase Storage build
  created_at timestamp with time zone default now()
);

create index if not exists chronicle_entries_date_idx on public.chronicle_entries(entry_date);
create index if not exists chronicle_entries_shift_idx on public.chronicle_entries(shift_id);

-- One morning note per day: the household writes (and amends) a single
-- note rather than stacking rivals.
create unique index if not exists one_morning_note_per_day
  on public.chronicle_entries(entry_date)
  where (tags @> '{morning}');

create table if not exists public.chronicle_reacts (
  entry_id bigint not null references public.chronicle_entries(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  kind text not null check (kind in ('seen', 'heart')),
  created_at timestamp with time zone default now(),
  primary key (entry_id, user_id, kind)
);

-- RLS. Entries: the household reads everything except household-only rows,
-- which stay between their author and family/admin; writes by author or
-- family/admin. Reacts: everyone reads, each person manages only their own.
alter table public.chronicle_entries enable row level security;
alter table public.chronicle_reacts enable row level security;

drop policy if exists chronicle_entries_select on public.chronicle_entries;
create policy chronicle_entries_select on public.chronicle_entries
  for select using (
    auth.role() = 'authenticated'
    and (
      not household_only
      or auth.uid() = author_id
      or exists (
        select 1 from public.profiles p where p.id = auth.uid() and p.role in ('family', 'admin')
      )
    )
  );

drop policy if exists chronicle_entries_modify on public.chronicle_entries;
create policy chronicle_entries_modify on public.chronicle_entries
  for all using (
    auth.uid() = author_id
    or exists (
      select 1 from public.profiles p where p.id = auth.uid() and p.role in ('family', 'admin')
    )
  ) with check (
    auth.uid() = author_id
    or exists (
      select 1 from public.profiles p where p.id = auth.uid() and p.role in ('family', 'admin')
    )
  );

drop policy if exists chronicle_reacts_select on public.chronicle_reacts;
create policy chronicle_reacts_select on public.chronicle_reacts
  for select using (auth.role() = 'authenticated');

drop policy if exists chronicle_reacts_modify on public.chronicle_reacts;
create policy chronicle_reacts_modify on public.chronicle_reacts
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- Realtime: the parents' Today card watches for the Seen receipt landing,
-- and the nanny's cockpit for a note written mid-morning. Add both tables
-- to the supabase_realtime publication (Dashboard -> Database ->
-- Replication), or uncomment and run — skip any already added:
-- ALTER PUBLICATION supabase_realtime ADD TABLE public.chronicle_entries;
-- ALTER PUBLICATION supabase_realtime ADD TABLE public.chronicle_reacts;
