---
title: Family Hub — Project Overview
type: project-overview
project: family-hub2.0
repo: itfitzreitzin/family-hub2.0
status: active, in production use by one household
started: 2025-10-03
last-major-update: 2026-08-11
doc-date: 2026-08-11
stack: [SvelteKit 2, Svelte 5, Vite 7, Supabase, ical.js]
tags: [family-hub, nanny, time-tracking, scheduling, household, side-project]
---

# Family Hub — What It Is, What We've Built, Where It's Going

> AI-readable reference. Facts below are verified against the codebase as of 2026-08-05
> (main @ `3aa70fe`, PR #29). The final section ("Where it may go") is forward-looking
> speculation, not shipped functionality.

## TL;DR

Family Hub is a private web app for running one household's childcare operation: a
shared workspace where the parents (Nick and Sarah) and their nanny track hours worked,
settle weekly pay over Venmo, and coordinate schedules against everyone's real
calendars. It replaces the usual mess of texted hours, mental math, and "are you free
Thursday?" with a single source of truth that all three roles log into.

It is deliberately small and personal — one family, one timezone, ~two runtime
dependencies — but built to production standards: database-enforced invariants,
realtime multi-device sync, row-level security, and a fully bespoke design system
("The Hearth & Hollow") with hand-drawn pixel art of the family itself.

## The story so far

- **Oct 2025 — v2.0 begins.** Fresh repo (the "2.0" name nods to an earlier
  iteration). First commits: Supabase auth + profiles, a basic shift tracker,
  then scheduling and mobile layout within the first week.
- **Oct–Nov 2025 — the scheduler era.** The schedule page went from a simple list to
  a real time-grid calendar: 24-hour grid at 15-minute resolution, click-to-add
  shifts, iCal feed sync so parents' work calendars overlay the grid, nanny
  calendar integration with conflict warnings, weekly hours/cost summaries, and a
  string of hard-won bug fixes (SSR crashes, week-navigation state, initial-load
  races).
- **~Jul 2026 — the reliability era.** A deep hardening pass on the tracker: shared
  time/Venmo/CSV modules, elimination of UTC date bugs (everything moved to
  deliberate device-local time), realtime sync across devices, database-level
  uniqueness (one open shift per nanny; one payment record per nanny per week),
  clock-out confirm modal with adjustable end time, overnight entries.
- **Jul–Aug 2026 — the identity era.** The app got its soul: the full "Hearth &
  Hollow" cozy-arcana redesign, the dashboard rebuilt as a "Today" page, a month
  calendar view, a ground-up iCal parser rewrite on ical.js (recurring events
  finally sync correctly, biweekly alternation fixed), and original pixel art —
  hearth scene, gilt frames, a painted shelf, portraits of Nick, Sarah, Jack, Emma,
  and the nanny — worked into the UI.

The build itself is a human+AI collaboration: ~70 commits on main split almost evenly
between Nick (34) and Claude (36), across ~27 merged PRs whose branch names
(`claude/fix-…`, `claude/visual-design-review-…`) are a log of the Claude sessions
that produced them.

## Core model

**One household, three roles** (stored on `profiles.role`, themed as tarot cards):

| Role | Card name | Can do |
|---|---|---|
| `admin` | The Keeper | Everything family can, plus the Admin page (nanny account management) and role changes |
| `family` | The Household | Run the schedule, clock the nanny in/out, record and send payments, connect calendars, manage the roster |
| `nanny` | The Guardian | Track own hours, view own schedule/history, request payment via Venmo, share availability from a personal calendar |

Assumptions baked in (fine for now, listed under "gaps" below): one household, one
timezone, a **two-parent** model ("You" / "Partner" in the calendar), and **only one
nanny on the clock at any moment** (enforced in app logic and by a DB index).

## Feature inventory (shipped)

### Entry: login and onboarding
- Email/password auth via Supabase. The login screen is styled as tarot card 0 —
  moon-phase crest (the *real* current lunar phase, computed astronomically) with a
  phase meaning as the motto; sign-up is "Light a candle."
- First login routes to **/setup**, "Choose your card": pick Family Member or
  Nanny/Caregiver; nannies also set an hourly rate (default $20) and Venmo handle.

### Today (dashboard, `/dashboard`)
- **Family/admin view:** greeting hero with the family pixel painting and moon
  phase; Upcoming Nanny Shift card; Hours & Payments card (live "shift in progress"
  alert, hours today, $ this week, all-time unpaid balance alert); mini month
  calendar dotted with shift days; quick actions. Plus a collapsible **Nanny
  Roster** with full CRUD — add a nanny (creates their login), edit rate/Venmo,
  see live "On clock / Resting" status with elapsed time, jump to their history.
- **Nanny view:** own hero, current-shift card with live timer, next upcoming
  shift, quick links.
- Live via a Supabase realtime channel on `time_entries`, a 30s poll, a 1s tick
  for elapsed displays, and refresh-on-tab-focus. In-progress shifts count toward
  today's hours and the weekly dollar total in real time.
- **"The Day — live" card** (family view; Chronicle build step 3): the ambient
  window onto a running shift — a composed status line ("Indigo napping since
  1:10 · mac & cheese, ate well · 2 potty stars"), the moment feed beneath, and
  the **morning note** block. Parents write/amend one note per morning (DB-
  enforced; defaults to tomorrow when written in the evening); it pins at the
  top of the nanny's cockpit until she taps **Seen ✓**, and the receipt (time,
  by whom) shows back on this card. Realtime on care_moments +
  chronicle_entries/reacts.
- A decorative "shelf" footer doubles as a balance-due indicator when money is
  outstanding.

### Tracker (`/tracker`) — the time clock and the purse
- **Live timer card** with HH:MM:SS elapsed. Clock in/out through confirm modals
  with editable times (guarded: no future times, end must follow start).
- Family/admin clock the nanny in and out and can add/edit/delete **manual
  entries** (overnight entries supported — an end time before the start rolls to
  the next day). Nannies cannot clock themselves in — the household does.
- **Weekly ledger:** Sunday–Saturday week navigation, entries table (date, in,
  out, hours, earnings, notes), week total with owed amount and payment status
  badge, CSV export (`timesheet-<nanny>-<week>.csv`).
- **Payments ("The Purse"):** one payment record per nanny per week, DB-enforced.
  Status is binary — recorded-unpaid → paid (with date, method). Family generates
  a **Venmo payment** (deep link on mobile with prefilled amount and an itemized
  note — week, hours, rate, total; clipboard copy on desktop). The record is
  written *before* the Venmo handoff so bookkeeping never depends on what happens
  in the app. Nannies get the mirror **"Request payment"** flow (a Venmo charge
  aimed at the first parent with a handle on file).
- Realtime-synced across devices (clock out on a phone and the wall tablet's timer
  stops, with a toast), with stale-response guards and race handling for
  duplicate open shifts.
- **The Care Day cockpit** (Chronicle build step 2): while a shift is running the
  big timer shrinks to a moss strip and a cockpit card takes the stage — kid-face
  scope chips, seven moment buttons (nap / meal / snack / potty / meds / note /
  heads-up), and the shift's live timeline. Naps are tap-to-start/tap-to-end with
  the shift timer's moss styling and a DB-enforced one-open-nap-per-kid; potty
  logs tried/success/accident (successes get a star, accidents log neutrally);
  the Meds button face shows today's last dose (double-dose guard) with recent
  names pre-filled; heads-up is the one ember-flagged tier meant for parents.
  Moments are editable after the fact by their author or family/admin, and the
  card realtime-syncs across devices.

### Calendar (`/schedule`) — family/admin's scheduling cockpit
- **Month view** (desktop default): six-week grid with up to 3 event pills per day
  + side panel showing the selected day, the next 5 upcoming items, and a legend.
  Month items unify four kinds via a shared data layer (`src/lib/calendar.js`):
  nanny shifts, family busy time, nanny unavailable time, and **payment-due**
  markers.
- **Week view:** 24-hour time grid, 15-minute slots, zebra hour bands, a live
  "now" line, hover ghost-slot, and **click-to-add** shifts. Events are fetched
  by true overlap and clipped per local day (midnight-crossing events render on
  both days); concurrent blocks lane-pack side by side. Mobile shows a 3-day
  slice.
- **Day view** (mobile default): single column of the same grid, compressed to
  6am–10pm with a "show full day" expander that counts hidden items; swipe
  between days on touch.
- **Shifts** live in the `schedules` table: create (defaults 9–5), edit, delete,
  with notes; saving jumps the view to the shift's week/month.
- **Repeating shifts:** a "Repeats" option (weekly/biweekly on chosen weekdays,
  optional end date) creates a `shift_templates` row that **materializes real
  `schedules` rows** 8 weeks ahead and tops up on page load — so every consumer
  (dashboard, tracker, coverage) reads plain shifts. Deleting one occurrence
  sticks (generated spans are never re-walked); a Repeats manager ends a series
  forward while history keeps its rows.
- **External calendars:** each person connects any iCal feed URL (Google/Outlook
  publish URLs — no OAuth). A server endpoint (`POST /api/calendar/sync`) fetches
  and parses feeds with ical.js — full RRULE expansion with timezone handling,
  exception/override support, stable per-instance IDs for clean re-sync upserts,
  and pruning of vanished events in a −180d/+365d window; hardened with a 20s
  fetch timeout, 10MB size cap, and an ownership check mirroring the RLS
  household model. Calendars are editable after connecting (name, color, feed
  URL — URL changes re-sync) and each card shows its feed host. Parents' busy
  time overlays the grid ("You" / partner's name); nanny busy time renders as
  "unavailable."
- **Sync you can see:** the schedule page shows per-feed freshness chips
  (warning past 24h, "sync failed" with the stored reason on a broken feed —
  `parent_calendars.sync_error`), click-to-resync, and quiet auto-resync of
  anything older than 6 hours on page load.
- **Manual busy times:** one-off entries, or recurring weekly/biweekly on chosen
  weekdays with an optional end date (biweekly alternation had a subtle
  midnight-anchor bug — now fixed and regression-commented). Existing entries
  are listed with edit and delete in the calendar manager.
- **Conflict warning** when booking a shift over the nanny's busy calendar
  (advisory, not blocking), and a **coverage-gap banner**: weekday working hours
  where *both* parents are busy and no nanny is scheduled.
- **Week summary:** family sees scheduled hours per nanny and estimated cost;
  the nanny sees their hours and estimated income.
- Nannies see the calendar read-only, scoped to themselves, with a privacy-framed
  "My Availability" flow for connecting their own calendar.

### History (`/history`) — the read-only ledger
- Completed shifts with three stat tiles (hours, total pay, effective rate),
  week/all-time toggle, per-nanny filter with an "Everyone" view (each entry
  priced at *that nanny's* rate), CSV export, and a convenience Venmo button that
  deliberately does **not** write payment records (the Tracker owns bookkeeping).

### Family (`/family`) — the household roster
- The whole household as data — parents, kids, pets — in one `family_members`
  table (Chronicle build step 1: everything the Care Day and Chronicle record
  anchors here). **Members ≠ accounts:** kids and pets never log in; a parent
  row carries a nullable `profile_id` link to their login ("Holds a key"
  badge); caregivers stay in `profiles` (payroll lives there).
- Parents are seeded from existing family/admin profiles by the migration;
  kids and pets are added in the app (their real names aren't in the repo —
  the painted "Jack"/"Emma" portraits are stand-ins until real ones arrive).
- Cards show portrait (avatar_url or a stable painted stand-in; pets get the
  cat sprite), age from birthdate, a kid's *current focus* (the habit that
  will get its own cockpit button), a pet's species, and freeform notes.
- Family/admin get add/edit/remove (kind-specific fields; one member per
  linked account, DB-enforced); the nanny sees the roster read-only.

### Admin (`/admin`) and Settings (`/settings`)
- Admin: nanny account management (create logins, edit rate/Venmo, delete with
  their entries).
- Settings: profile editing (nannies/admins manage rate + Venmo), password change,
  role display with card title; only admins can change roles.

## Data model (Supabase Postgres)

| Table | Purpose | Notes |
|---|---|---|
| `profiles` | id → role, full_name, hourly_rate, venmo_username | Extends `auth.users` |
| `time_entries` | Worked shifts: nanny_id, clock_in, clock_out, hours, notes | Partial unique index: **one open shift per nanny** |
| `payments` | Weekly pay records: week_start/end, hours, amount, is_paid, paid_date, method | Unique **(nanny_id, week_start)**; week_end = start + 6 |
| `schedules` | Planned shifts: nanny_id, date, start/end time, notes, created_by | The live planning table |
| `parent_calendars` | Connected calendar sources: type (google/outlook/ical/manual), feed URL, color, sync_enabled, last_synced, sync_error | sync_error added by `calendar_sync_state.sql` |
| `calendar_events` | Synced busy events | Unique (calendar_id, event_id) for re-sync dedup; also holds one-off manual busy entries |
| `manual_busy_times` | Recurring manual busy time: pattern weekly/biweekly(/monthly unused), weekday list, until | Expanded client-side |
| `shift_templates` | Repeating shift series: days[], pattern, times, starts_on, until, generated_until | Added by `shift_templates.sql`; materializes into `schedules` (rows carry nullable `template_id`) |
| `family_members` | The household roster: name, kind (parent/child/pet), birthdate, avatar_url, profile_id (nullable FK), current_focus, species, routines, notes | Added by `family_members.sql`; uuid ids (care tables reference `kid_ids uuid[]`); partial unique: **one member per profile** |
| `care_moments` | The Care Day's taps: kind (nap/meal/snack/potty/meds/note/headsup), kid_ids uuid[], shift_id (nullable FK), started_at/ended_at, payload jsonb | Added by `care_moments.sql`; generated `nap_kid_id` column + partial unique: **one open nap per kid** |
| `chronicle_entries` | The journal's written layer: author, entry_date, body, tags text[], kid_ids uuid[], shift_id, household_only, photo_url | Added by `chronicle_entries.sql`; partial unique: **one 'morning'-tagged note per day**; RLS hides household_only rows from the nanny |
| `chronicle_reacts` | One-tap acknowledgements: (entry_id, user_id, kind 'seen'/'heart') | Same file; each person writes only their own rows — how the nanny stamps Seen without edit rights |
| `availability`, `schedule_blocks` | Defined in `supabase/schedule.sql` | **Legacy — no longer referenced by code** |

Security: RLS on all tables — any authenticated household member can read;
writes require ownership or family/admin role. Realtime publication on
`time_entries` and `payments`. Two SQL "fix" scripts in `supabase/` document
production incidents (duplicate open shifts; duplicate weekly payments) and the
constraints that now prevent them.

## Architecture & engineering decisions

- **SvelteKit 2 + Svelte 5**, plain JS with JSDoc types checked by `svelte-check`;
  Prettier + ESLint. Two runtime dependencies total: `@supabase/supabase-js`,
  `ical.js`.
- **Client-heavy:** pages talk to Supabase directly under RLS; the only server
  code is the calendar-sync endpoint (which uses a service-role key when
  configured, falling back to the caller's JWT for local dev).
- **Device-local time on purpose.** All date math (`src/lib/time.js`) is
  wall-clock local: one household, one timezone. This was a lesson — UTC/ISO
  string building shifted evening entries onto the next day. Weeks are
  Sunday–Saturday.
- **Invariants live in the database**, not just the UI: one open shift per nanny,
  one payment per nanny-week, dedup on synced events — each added after a real
  bug, with 23505 unique-violation handling in the app.
- **Realtime with humility:** unfiltered channels (filtered subscriptions miss
  clock-out UPDATEs and DELETEs), debounced resyncs, monotonic load tokens to
  drop stale responses, resync on tab visibility/focus.
- **Record before handoff:** payment rows are written before opening Venmo, so
  bookkeeping never depends on an external app.
- **Zero third-party runtime requests:** fonts self-hosted, icons hand-drawn,
  no analytics, no CDN.

## Design system — "The Hearth & Hollow"

The look is **cozy-arcana**: tarot gilt over pixel-farm warmth. It's a real design
system, documented in the README and enforced by semantic tokens.

- **Two themes** on `data-theme`: *Midnight Arcana* (dark, default) and *Candlelit
  Almanac* (light), resolved by an inline script before first paint (no flash).
- **Tokens only** — `--surface`, `--text`, `--accent` (gilt), `--growing` (moss =
  "on the clock"), `--danger` (ember), `--border-gilt`. Both themes define the
  same set.
- **Type:** Cinzel (headings), Cinzel Decorative (wordmark), Alegreya Sans (body),
  Pixelify Sans (the shift timer only — its 5/8 are confusable small, so tables
  use tabular-nums body figures). All OFL, self-hosted.
- **Icons as source code:** original 16×16 sprites in `src/lib/icons/sprites.js`
  where each icon *is* its picture — sixteen rows of sixteen characters
  (`#` = currentColor, `o` = gilt, `~` = moss…). Edit the art by editing the grid.
- **Pixel paintings** (downscaled from 1024px masters): the hearth family scene,
  gilt corner filigree, a three-part painted shelf, still lifes, painted nav
  icons, and **portraits of Nick, Sarah, Jack, Emma, and the nanny**. A stable
  hash assigns adult portraits as avatar stand-ins.
- **Flavor with function:** a real moon-phase component (accurate to hours) on the
  login crest; role titles as arcana; empty states as illustrated vignettes
  ("The purse is empty," "The scrying pool is clouded"); skeleton loaders.

## Known gaps & quirks (honest list)

*Product*
- Payment status is binary (unpaid/paid) — a nanny's "Request payment" leaves no
  DB trace; there's no "requested" state or notification.
- No server-side sync cron — auto-sync runs when someone opens the schedule
  page, so feeds still stale out if nobody visits. No OAuth (secret ICS URLs
  only).
- Monthly recurrence is deliberately unsupported (busy times and shift
  templates are weekly/biweekly).
- Repeating-shift series can be ended but not edited-forward (change a series =
  end it and create a new one); generation horizon is 8 weeks, topped up on
  schedule-page load by family/admin visits.
- Overnight shifts work in tracker manual entry but can't be *scheduled* (form
  requires start < end).
- Two-parent household and single-active-nanny assumptions are hardcoded;
  coverage-gap working hours are constants (8am–6pm weekdays), not a setting.
- No push/email notifications of any kind.

*Technical debt & security notes (private-household threat model)*
- RLS reads are household-wide by design, so the "only busy/free is shared"
  copy overpromises: synced event titles are stored and visible.
- Delete/toggle in the calendar manager surface zero-row RLS refusals loudly
  now — if those toasts appear in production, the live RLS policies need
  reconciling with the repo's SQL files.
- `$20/hr` fallback rate is scattered across five files.
- Legacy artifacts: `availability`/`schedule_blocks` SQL vs. the live `schedules`
  table.
- `adapter-auto` with no pinned deploy target in-repo.

*Recent (2026-08-11, PR #30 + follow-up branch)*
- Shipped: sync freshness chips + auto-resync + endpoint hardening; busy-time
  and calendar editing; week-view overlap/clipping/lane-packing rewrite;
  double-booking conflict checks; Day view (mobile default); repeating shifts.
- Removed: the unused `weekly_coverage_summary` query and the dead
  `WeekNavigator` component.
- Migrations to run once in Supabase: `calendar_sync_state.sql`,
  `shift_templates.sql`.

*Recent (2026-08-11, Chronicle build steps 1–3)*
- Shipped: `family_members` (parents, kids, pets — members, not accounts) and
  the Family page (`/family`) to manage them, wearing the `nav-home.png` art.
- Shipped: the Care Day cockpit on the Tracker — moment buttons + live shift
  timeline (`care_moments`), with the shift timer compressed to a strip while
  on the clock.
- Shipped: the morning note with Seen receipt, and the parents' "The Day —
  live" card on Today (`chronicle_entries` + `chronicle_reacts`).
- Migrations to run once in Supabase, in order: `family_members.sql` (seeds
  parent rows from family/admin profiles), then `care_moments.sql`, then
  `chronicle_entries.sql` (add `care_moments`, `chronicle_entries` and
  `chronicle_reacts` to the realtime publication alongside them).

## Where it may go (speculative — edit me)

Signals already in the repo point somewhere: pixel art exists for a **nav-care**
tab that doesn't exist yet (nav-home now fronts the Family page), plus
drawn-but-unwired icons (thermometer, droplet, cauldron) and a "rituals" motif
already on the Today page. The name was never "Nanny Hub" — the childcare-ops
core looks like the first module of something bigger.

**Near term — finish the loop on childcare ops**
- Payment lifecycle: a real requested → paid flow with notifications.
- Recurring shift templates ("every weekday 8–4") and schedule-from-pattern.
- Scheduled calendar sync (cron) + calendar edit/delete parity.
- PWA install + push notifications (shift reminders, "clocked in 10h?" nudges).
- Year-end exports (nanny tax / household employer paperwork from the ledger).

**Next up — designed and specced:** the Chronicle (family journal) and the Care
Day (live shift cockpit) — see **`CHRONICLE_CARE_DAY.md`** for the full agreed
design, data model, and build order. Steps 1–3 (family_members + the Family
page; the Care Day cockpit on the Tracker; the morning note + Seen receipt +
the parents' live Today card) have shipped; the wrap-up auto-draft at
clock-out (step 4) is next.

**Mid term — from nanny ops to family ops** (the drawn-but-unused art's roadmap)
- **Care log:** feeds, naps, temperatures, medicine (thermometer/droplet icons) —
  the nanny's shift becomes a rich handoff note, not just hours.
- **Rituals:** recurring household routines and chores with streaks — bedtime,
  allowance, watering the plants (the Today page already frames actions this way).
- **Meals:** planning and the shared grocery list (the cauldron).
- **Kids as first-class entities:** shipped as `family_members` (broader than a
  `children` table — parents and pets too); care logs, rituals, and milestones
  anchor to it from here.
- Coverage autopilot: the gap-detector already finds "both parents busy, no nanny"
  — next step is suggesting/requesting coverage automatically.

**Long term — the household OS / second-brain integration**
- The hub as the family's **structured memory**: an API/MCP surface over the
  Supabase schema so AI assistants (and the second-brain system this doc lives in)
  can query "how many hours did we use in March?", "when did the fever start?",
  "what's unpaid?" — and act: schedule coverage, draft the Venmo, file the CSV.
- Multi-household generalization is *possible* (nothing family-specific is
  hardcoded except art), but the charm is that it's ours; productizing is a
  choice, not a default.

## Quick reference (for retrieval)

- **Routes:** `/` (login) · `/setup` · `/dashboard` (Today) · `/tracker` ·
  `/schedule` (family/admin) · `/family` · `/history` · `/admin` (admin) ·
  `/settings` · `POST /api/calendar/sync`
- **Key files:** `src/lib/time.js` (local-time policy, week bounds) ·
  `src/lib/calendar.js` (unified calendar items + recurrence expansion) ·
  `src/lib/server/ical-parser.js` (ical.js RRULE engine) · `src/lib/venmo.js` ·
  `src/lib/csv.js` · `src/lib/icons/sprites.js` (icon art) · `src/lib/art.js`
  (painting manifest) · `src/app.css` (the entire design system) ·
  `supabase/*.sql` (schema + incident fixes)
- **People:** parents Nick & Sarah; one nanny role with rate + Venmo handle.
  The household roster (kids, pets) lives in `family_members`, entered in-app —
  the painted "Jack"/"Emma" portraits are stand-ins for the real kids.
- **Money math:** pay = hours × nanny's `hourly_rate` (fallback 20);
  weeks Sun–Sat local; one payment row per nanny-week.
