-- Care moments: the taps that build the Care Day.
--
-- Step 2 of CHRONICLE_CARE_DAY.md. Each row is one logged moment during a
-- shift — a nap, a meal or snack, a potty outcome, a med dose, a note, or a
-- heads-up (the only tier meant to reach parents right away). Naps are the
-- one duration-shaped kind: started_at/ended_at bracket them and ended_at
-- stays null while the kid is asleep. Everything else is a point in time
-- with its detail in `payload` (meal detail + appetite, potty outcome,
-- med name + dose, note text).
--
-- kid_ids references family_members (uuid) as an array so one tap can cover
-- both kids — except naps, which are per kid so each sleeper gets their own
-- timer. That's what lets the database enforce "one open nap per kid" the
-- same way one_open_shift_per_nanny guards the tracker: a stored generated
-- column exposes the nap's single kid, and a partial unique index refuses a
-- second open nap for them.
--
-- Run once in Supabase Dashboard -> SQL Editor, after family_members.sql.
-- NOTE: shift_id assumes time_entries.id is uuid (the shipped table's key
-- type); if your time_entries uses a bigint key, change the column type to
-- match before running.

create table if not exists public.care_moments (
  id bigint generated always as identity primary key,
  shift_id uuid references public.time_entries(id) on delete set null,
  author_id uuid references auth.users(id) on delete set null,
  kind text not null check (kind in ('nap', 'meal', 'snack', 'potty', 'meds', 'note', 'headsup')),
  kid_ids uuid[] not null default '{}',
  nap_kid_id uuid generated always as (case when kind = 'nap' then kid_ids[1] end) stored,
  started_at timestamp with time zone not null,
  ended_at timestamp with time zone,          -- naps only: null while asleep
  payload jsonb,
  created_at timestamp with time zone default now(),
  constraint care_moment_ends_after_start check (ended_at is null or ended_at > started_at),
  -- coalesce matters: array_length('{}') is null, and a null CHECK passes
  constraint nap_has_one_kid check (kind <> 'nap' or coalesce(array_length(kid_ids, 1), 0) = 1)
);

create index if not exists care_moments_shift_idx on public.care_moments(shift_id);
create index if not exists care_moments_time_idx on public.care_moments(started_at);
create index if not exists care_moments_kind_time_idx on public.care_moments(kind, started_at);

-- One open nap per kid, enforced by the database (not just the UI).
create unique index if not exists one_open_nap_per_kid
  on public.care_moments(nap_kid_id)
  where (kind = 'nap' and ended_at is null);

-- RLS: the whole household reads the day; a moment is editable by its
-- author or family/admin (the nanny can amend her own taps, not erase the
-- parents').
alter table public.care_moments enable row level security;

drop policy if exists care_moments_select on public.care_moments;
create policy care_moments_select on public.care_moments
  for select using (auth.role() = 'authenticated');

drop policy if exists care_moments_modify on public.care_moments;
create policy care_moments_modify on public.care_moments
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

-- Realtime: the parents' live card (build step 3) and a second device's
-- cockpit both watch this table. Add care_moments to the supabase_realtime
-- publication (Dashboard -> Database -> Replication), or uncomment and run —
-- skip if already added (re-adding errors):
-- ALTER PUBLICATION supabase_realtime ADD TABLE public.care_moments;
