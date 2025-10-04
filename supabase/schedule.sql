-- Run this in the Supabase SQL editor (or psql) in your project.
-- Creates minimal tables to support the /schedule page and (optionally) availability.

-- availability: recurring weekly windows when a nanny is available
create table if not exists public.availability (
  id bigint generated always as identity primary key,
  nanny_id uuid not null references auth.users(id) on delete cascade,
  day_of_week int not null check (day_of_week between 0 and 6), -- 0=Sun
  start_time time not null,
  end_time time not null,
  inserted_at timestamp with time zone default now()
);

create index if not exists availability_nanny_day_idx on public.availability(nanny_id, day_of_week);

-- schedule_blocks: one-off scheduled blocks (planned shifts)
create table if not exists public.schedule_blocks (
  id bigint generated always as identity primary key,
  nanny_id uuid not null references auth.users(id) on delete cascade,
  date date not null,
  start_time time not null,
  end_time time not null,
  notes text,
  created_by uuid references auth.users(id),
  created_at timestamp with time zone default now()
);

create index if not exists schedule_blocks_nanny_date_idx on public.schedule_blocks(nanny_id, date);

-- Optional: enable RLS (recommended)
alter table public.availability enable row level security;
alter table public.schedule_blocks enable row level security;

-- Policies
-- Helper: profiles table must map id -> role
-- Read availability: any authenticated user can read availability for any nanny
drop policy if exists availability_select on public.availability;
create policy availability_select on public.availability
  for select using (auth.role() = 'authenticated');

-- Modify availability: only family/admin can manage, or the nanny themselves
drop policy if exists availability_modify on public.availability;
create policy availability_modify on public.availability
  for all using (
    auth.uid() = nanny_id
    or exists (
      select 1 from public.profiles p where p.id = auth.uid() and p.role in ('family','admin')
    )
  ) with check (
    auth.uid() = nanny_id
    or exists (
      select 1 from public.profiles p where p.id = auth.uid() and p.role in ('family','admin')
    )
  );

-- Read schedule blocks: any authenticated user can read (nannies see their plan; parents/admin plan for nannies)
drop policy if exists schedule_blocks_select on public.schedule_blocks;
create policy schedule_blocks_select on public.schedule_blocks
  for select using (auth.role() = 'authenticated');

-- Modify schedule blocks: only family/admin can create/update/delete, or the nanny themself for their own blocks
drop policy if exists schedule_blocks_modify on public.schedule_blocks;
create policy schedule_blocks_modify on public.schedule_blocks
  for all using (
    auth.uid() = nanny_id
    or exists (
      select 1 from public.profiles p where p.id = auth.uid() and p.role in ('family','admin')
    )
  ) with check (
    auth.uid() = nanny_id
    or exists (
      select 1 from public.profiles p where p.id = auth.uid() and p.role in ('family','admin')
    )
  );

-- Notes:
-- 1) If your project has RLS disabled by default, you may omit the RLS/policies.
-- 2) If you want to store per‑nanny guarantees, add a new column to profiles:
--    alter table public.profiles add column if not exists weekly_min_hours numeric default 0;
--    Then surface it in the UI instead of the hardcoded 15.
-- 3) Consider adding constraints (start_time < end_time) and preventing overlaps at DB layer with an exclusion constraint if needed.

