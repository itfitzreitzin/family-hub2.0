-- Amounts on the grocery list, and the recipe book.
--
-- grocery_items.quantity is how many or how much — "2", "2 lb", "1 (15 oz)
-- can" — kept apart from the name, so "Milk" is still one thing to the
-- one-open-item-per-name rule and to the quick-add suggestions. There's no
-- separate field to fill in: the app reads the amount out of what's typed
-- ("2 milk", "ground beef 2 lb", "milk x2").
--
-- recipes is the household's recipe book: a name, how many it serves, and the
-- recipe as written or pasted — the ingredients one per line, and the method
-- too if it came along. The app reads the ingredient lines into grocery items
-- when a recipe goes onto a list, so a better reader later improves every
-- saved recipe without touching the rows. last_used_at puts the ones the
-- house actually cooks first.
--
-- Who can do what: parents read and write both. The nanny keeps adding to
-- the grocery list from Care (amounts included) and doesn't see the book.
--
-- Run once in Supabase Dashboard -> SQL Editor, after grocery_items.sql
-- (it uses household_access.sql's is_household_parent helper). Safe to run
-- again. Until it runs, the list works as before — amounts ride in the note —
-- and the recipe sheet can read a pasted recipe but not keep one.

alter table public.grocery_items
  add column if not exists quantity text
  check (quantity is null or length(quantity) <= 40);

create table if not exists public.recipes (
  id bigint generated always as identity primary key,
  name text not null check (length(btrim(name)) between 1 and 80),
  servings integer check (servings is null or servings between 1 and 99),
  body text not null default '' check (length(body) <= 20000),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),
  last_used_at timestamp with time zone
);

-- One "Chili" in the book, whatever the case or stray spaces.
create unique index if not exists recipes_unique_name
  on public.recipes (lower(btrim(name)));

alter table public.recipes enable row level security;

drop policy if exists recipes_parents on public.recipes;
create policy recipes_parents on public.recipes for all
  using ((select public.is_household_parent()))
  with check ((select public.is_household_parent()));
