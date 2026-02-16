-- Calendar integration tables for Family Hub
-- Run this in the Supabase SQL editor after schedule.sql

-- parent_calendars: stores connected calendar sources (Google, Outlook, iCal feeds, manual)
create table if not exists public.parent_calendars (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  calendar_name text not null,
  calendar_type text not null check (calendar_type in ('google', 'outlook', 'ical', 'manual')),
  calendar_url text,         -- iCal feed URL for ical type
  calendar_id text,          -- external calendar ID (e.g. Google calendar ID)
  color text default '#667eea',
  sync_enabled boolean default true,
  last_synced timestamp with time zone,
  created_at timestamp with time zone default now()
);

create index if not exists parent_calendars_user_idx on public.parent_calendars(user_id);

-- calendar_events: individual events pulled from connected calendars
create table if not exists public.calendar_events (
  id bigint generated always as identity primary key,
  calendar_id bigint not null references public.parent_calendars(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  event_id text not null,    -- external event UID for dedup
  title text not null default 'Busy',
  start_time timestamp with time zone not null,
  end_time timestamp with time zone not null,
  is_busy boolean default true,
  created_at timestamp with time zone default now()
);

create index if not exists calendar_events_calendar_idx on public.calendar_events(calendar_id);
create index if not exists calendar_events_user_time_idx on public.calendar_events(user_id, start_time);
-- Unique constraint to prevent duplicate events on re-sync
create unique index if not exists calendar_events_dedup_idx on public.calendar_events(calendar_id, event_id);

-- manual_busy_times: manually entered busy times (single or recurring)
create table if not exists public.manual_busy_times (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null,
  start_time timestamp with time zone not null,
  end_time timestamp with time zone not null,
  recurring boolean default false,
  recurring_pattern text check (recurring_pattern in ('weekly', 'biweekly', 'monthly')),
  recurring_days text[],     -- e.g. {'monday', 'wednesday', 'friday'}
  recurring_until date,
  created_at timestamp with time zone default now()
);

create index if not exists manual_busy_times_user_idx on public.manual_busy_times(user_id);

-- Enable RLS on all tables
alter table public.parent_calendars enable row level security;
alter table public.calendar_events enable row level security;
alter table public.manual_busy_times enable row level security;

-- RLS Policies for parent_calendars
drop policy if exists parent_calendars_select on public.parent_calendars;
create policy parent_calendars_select on public.parent_calendars
  for select using (auth.role() = 'authenticated');

drop policy if exists parent_calendars_modify on public.parent_calendars;
create policy parent_calendars_modify on public.parent_calendars
  for all using (
    auth.uid() = user_id
    or exists (
      select 1 from public.profiles p where p.id = auth.uid() and p.role in ('family', 'admin')
    )
  ) with check (
    auth.uid() = user_id
    or exists (
      select 1 from public.profiles p where p.id = auth.uid() and p.role in ('family', 'admin')
    )
  );

-- RLS Policies for calendar_events
drop policy if exists calendar_events_select on public.calendar_events;
create policy calendar_events_select on public.calendar_events
  for select using (auth.role() = 'authenticated');

drop policy if exists calendar_events_modify on public.calendar_events;
create policy calendar_events_modify on public.calendar_events
  for all using (
    auth.uid() = user_id
    or exists (
      select 1 from public.profiles p where p.id = auth.uid() and p.role in ('family', 'admin')
    )
  ) with check (
    auth.uid() = user_id
    or exists (
      select 1 from public.profiles p where p.id = auth.uid() and p.role in ('family', 'admin')
    )
  );

-- RLS Policies for manual_busy_times
drop policy if exists manual_busy_times_select on public.manual_busy_times;
create policy manual_busy_times_select on public.manual_busy_times
  for select using (auth.role() = 'authenticated');

drop policy if exists manual_busy_times_modify on public.manual_busy_times;
create policy manual_busy_times_modify on public.manual_busy_times
  for all using (
    auth.uid() = user_id
    or exists (
      select 1 from public.profiles p where p.id = auth.uid() and p.role in ('family', 'admin')
    )
  ) with check (
    auth.uid() = user_id
    or exists (
      select 1 from public.profiles p where p.id = auth.uid() and p.role in ('family', 'admin')
    )
  );
