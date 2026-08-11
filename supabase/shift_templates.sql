-- Repeating shift schedules ("Daniella works Mon/Wed/Fri 9-4:30").
--
-- Templates MATERIALIZE into ordinary public.schedules rows a few weeks
-- ahead (the app tops the horizon up on schedule-page load), so every
-- existing consumer — dashboard, tracker, coverage gaps — keeps reading
-- schedules unchanged. generated_until records how far rows exist; the
-- generator only ever moves it forward, which is also what makes deleting
-- a single occurrence stick (that span is never regenerated).
--
-- Run once in Supabase Dashboard -> SQL Editor, after schedule tables exist.

create table if not exists public.shift_templates (
  id bigint generated always as identity primary key,
  nanny_id uuid not null references auth.users(id) on delete cascade,
  days text[] not null,             -- lowercase weekday names, e.g. {'monday','wednesday'}
  pattern text not null default 'weekly' check (pattern in ('weekly', 'biweekly')),
  start_time time not null,
  end_time time not null,
  notes text,
  starts_on date not null,          -- first date the series may generate
  until date,                       -- null = open-ended
  generated_until date not null,    -- schedules rows exist through this date
  created_by uuid references auth.users(id),
  created_at timestamp with time zone default now()
);

create index if not exists shift_templates_nanny_idx on public.shift_templates(nanny_id);

-- Occurrences remember their series; ending a series keeps past rows as
-- plain shifts (history must not vanish with the template).
alter table public.schedules
  add column if not exists template_id bigint references public.shift_templates(id) on delete set null;

create index if not exists schedules_template_idx on public.schedules(template_id);

-- RLS mirrors the schedules policy: household can read, family/admin manage.
alter table public.shift_templates enable row level security;

drop policy if exists shift_templates_select on public.shift_templates;
create policy shift_templates_select on public.shift_templates
  for select using (auth.role() = 'authenticated');

drop policy if exists shift_templates_modify on public.shift_templates;
create policy shift_templates_modify on public.shift_templates
  for all using (
    exists (
      select 1 from public.profiles p where p.id = auth.uid() and p.role in ('family', 'admin')
    )
  ) with check (
    exists (
      select 1 from public.profiles p where p.id = auth.uid() and p.role in ('family', 'admin')
    )
  );
