-- The Care Sheet: the one page a sitter needs.
--
-- Step 6 of CHRONICLE_CARE_DAY.md. Household-wide facts live on a
-- database-enforced singleton row (the `one` latch permits exactly one):
-- emergency contacts, authorized pickups, house notes. Per-kid safety data
-- lives on the kid's own family_members row — allergies, the dosing chart,
-- and routines (the jsonb column reserved by family_members.sql, holding
-- free text). Parents author the sheet; the whole household reads it —
-- it exists FOR the nanny, so only writes are restricted.
--
-- Run once in Supabase Dashboard -> SQL Editor, after family_members.sql.

create table if not exists public.care_sheet (
  one boolean primary key default true check (one),  -- singleton latch
  contacts jsonb not null default '[]',    -- [{ name, relation, phone }]
  pickups jsonb not null default '[]',     -- [{ name, relation, note }]
  house_notes text,
  updated_at timestamp with time zone default now(),
  updated_by uuid references auth.users(id) on delete set null
);

-- The one row, ready to fill in.
insert into public.care_sheet (one) values (true)
on conflict do nothing;

-- Per-kid safety columns. `dosing` is the shared chart the cockpit's meds
-- log complements: [{ medicine, dose, every, note }].
alter table public.family_members
  add column if not exists allergies text,
  add column if not exists dosing jsonb not null default '[]';

-- RLS: household reads, family/admin write. The nanny consumes the sheet;
-- the dosing chart and pickup list stay in the parents' hands.
alter table public.care_sheet enable row level security;

drop policy if exists care_sheet_select on public.care_sheet;
create policy care_sheet_select on public.care_sheet
  for select using (auth.role() = 'authenticated');

drop policy if exists care_sheet_modify on public.care_sheet;
create policy care_sheet_modify on public.care_sheet
  for all using (
    exists (
      select 1 from public.profiles p where p.id = auth.uid() and p.role in ('family', 'admin')
    )
  ) with check (
    exists (
      select 1 from public.profiles p where p.id = auth.uid() and p.role in ('family', 'admin')
    )
  );
