-- The family itself, as data: parents, kids, and pets in one table.
--
-- Step 1 of CHRONICLE_CARE_DAY.md. Everything the Chronicle and the Care Day
-- record will anchor to these rows, so they come first. Members are NOT
-- accounts: kids and pets never log in, and caregivers stay in `profiles`
-- (payroll lives there). A member who does log in (a parent) carries a
-- nullable link to their profile. Ids are uuid because later tables
-- reference members in uuid[] columns (care_moments.kid_ids).
--
-- Run once in Supabase Dashboard -> SQL Editor.

create table if not exists public.family_members (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  kind text not null check (kind in ('parent', 'child', 'pet')),
  birthdate date,                -- optional; the UI shows an age when set
  avatar_url text,               -- optional; falls back to the painted portraits
  profile_id uuid references public.profiles(id) on delete set null,
  current_focus text,            -- kids: the one habit in focus ("potty training")
  species text,                  -- pets: "cat", "dog"…
  routines jsonb,                -- reserved for the Care Sheet build
  notes text,
  created_at timestamp with time zone default now()
);

-- One member row per login: a profile can back at most one member.
create unique index if not exists one_member_per_profile
  on public.family_members(profile_id)
  where (profile_id is not null);

create index if not exists family_members_kind_idx on public.family_members(kind);

-- RLS: the whole household reads the roster; family/admin manage it.
alter table public.family_members enable row level security;

drop policy if exists family_members_select on public.family_members;
create policy family_members_select on public.family_members
  for select using (auth.role() = 'authenticated');

drop policy if exists family_members_modify on public.family_members;
create policy family_members_modify on public.family_members
  for all using (
    exists (
      select 1 from public.profiles p where p.id = auth.uid() and p.role in ('family', 'admin')
    )
  ) with check (
    exists (
      select 1 from public.profiles p where p.id = auth.uid() and p.role in ('family', 'admin')
    )
  );

-- Seed the parents from their existing accounts (family and admin profiles),
-- so the roster starts with real names instead of placeholders. Kids and pets
-- are added in the app — their real names aren't in the database yet.
-- Re-running is safe: linked profiles are skipped.
insert into public.family_members (name, kind, profile_id)
select coalesce(p.full_name, 'Parent'), 'parent', p.id
from public.profiles p
where p.role in ('family', 'admin')
  and not exists (
    select 1 from public.family_members m where m.profile_id = p.id
  );
