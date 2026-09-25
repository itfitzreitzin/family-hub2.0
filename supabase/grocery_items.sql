-- The grocery lists: what the house needs, tapped off at the store.
--
-- grocery_lists holds the lists themselves — "Groceries" to start, then
-- whatever the household adds (Costco, Target, the pharmacy). grocery_items
-- holds one row per thing to buy, on one list. It stays on the list while
-- checked_at is null; tapping it off stamps checked_at/checked_by, and
-- "Clear the basket" stamps cleared_at. Rows are never deleted on the way through, so the list keeps
-- its own history — what gets bought, how often, and who asked for it —
-- which drives the quick-add suggestions now and price tracking later.
--
-- Who can do what:
--   parents  read and change everything;
--   the nanny adds things ("out of wipes") and sees only what they added,
--             and can take back their own addition before it's bought.
--
-- The same thing can't be on a list twice: a partial unique index on the
-- list and the normalized name refuses a second open "Milk" (the app says
-- it's already there). Deleting a list deletes its items and their history.
--
-- Run once in Supabase Dashboard -> SQL Editor, after household_access.sql
-- (it uses that file's is_household_member / is_household_parent helpers).

create table if not exists public.grocery_lists (
  id bigint generated always as identity primary key,
  name text not null check (length(btrim(name)) between 1 and 40),
  position integer not null default 0,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamp with time zone default now()
);

create unique index if not exists grocery_lists_unique_name
  on public.grocery_lists (lower(btrim(name)));

-- Every household starts with one.
insert into public.grocery_lists (name, position)
select 'Groceries', 0
where not exists (select 1 from public.grocery_lists);

create table if not exists public.grocery_items (
  id bigint generated always as identity primary key,
  list_id bigint not null references public.grocery_lists(id) on delete cascade,
  name text not null check (length(btrim(name)) between 1 and 80),
  note text check (note is null or length(note) <= 200),
  added_by uuid references auth.users(id) on delete set null,
  added_at timestamp with time zone not null default now(),
  checked_at timestamp with time zone,
  checked_by uuid references auth.users(id) on delete set null,
  cleared_at timestamp with time zone
);

create index if not exists grocery_items_open_idx on public.grocery_items(added_at)
  where checked_at is null;
create index if not exists grocery_items_checked_idx on public.grocery_items(checked_at);

-- One open item per name on each list, whatever the case or stray spaces.
create unique index if not exists one_open_grocery_per_name
  on public.grocery_items (list_id, lower(btrim(name)))
  where checked_at is null;

-- Lists: everyone sees them (the nanny picks which one to add to); parents
-- make, rename and remove them.
alter table public.grocery_lists enable row level security;

drop policy if exists grocery_lists_select on public.grocery_lists;
create policy grocery_lists_select on public.grocery_lists for select
  using ((select public.is_household_member()));

drop policy if exists grocery_lists_write on public.grocery_lists;
create policy grocery_lists_write on public.grocery_lists for all
  using ((select public.is_household_parent()))
  with check ((select public.is_household_parent()));

alter table public.grocery_items enable row level security;

drop policy if exists grocery_items_select on public.grocery_items;
create policy grocery_items_select on public.grocery_items for select
  using (
    (select public.is_household_parent())
    or (added_by = auth.uid() and (select public.is_household_member()))
  );

drop policy if exists grocery_items_insert on public.grocery_items;
create policy grocery_items_insert on public.grocery_items for insert
  with check (
    added_by = auth.uid()
    and checked_at is null
    and (select public.is_household_member())
  );

drop policy if exists grocery_items_update on public.grocery_items;
create policy grocery_items_update on public.grocery_items for update
  using ((select public.is_household_parent()))
  with check ((select public.is_household_parent()));

drop policy if exists grocery_items_delete on public.grocery_items;
create policy grocery_items_delete on public.grocery_items for delete
  using (
    (select public.is_household_parent())
    or (added_by = auth.uid() and checked_at is null and (select public.is_household_member()))
  );

-- Realtime: two phones at the store stay in step. Safe to re-run.
do $$
declare
  t text;
begin
  foreach t in array array['grocery_items', 'grocery_lists'] loop
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t
    ) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end;
$$;
