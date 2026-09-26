---
title: Family Hub — Project Overview
type: project-overview
project: family-hub2.0
repo: itfitzreitzin/family-hub2.0
status: active, in production use by one household
started: 2025-10-03
last-major-update: 2026-09-24
doc-date: 2026-09-24
stack: [SvelteKit 2, Svelte 5, Vite 7, Supabase, ical.js]
tags: [family-hub, nanny, time-tracking, childcare, household, home-hub, side-project]
---

# Family Hub — What It Is, What We've Built, Where It's Going

> AI-readable reference. Facts below are verified against the codebase as of 2026-09-24
> (the Home/Care restructure). The final section ("Where it may go") is forward-looking:
> the agreed plan plus speculation, not shipped functionality.

## TL;DR

Family Hub is a private web app for running one household: Nick, Rhea, and their
daughter Indigo. It started as the childcare operation — the parents and their nanny
track hours worked, settle weekly pay over Venmo, and log Indigo's day — and in Sept
2026 it was reorganized into two halves: **Home**, the household's page (the seed for
a grocery list, chores, a shared calendar and Home Assistant), and **Care**, everything
about Indigo and the nanny. It replaces the usual mess of texted hours, mental math,
and "how was the nap?" with a single source of truth that all three roles log into.

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
  hearth scene, gilt frames, a painted shelf, and stand-in portraits — worked into
  the UI.
- **Aug 2026 — the Chronicle & Care Day.** The kids' side: a family roster, the
  Care Day cockpit (tap-to-log naps, meals, potty, meds), the morning note, the
  clock-out wrap-up, the family journal and the Care Sheet (see
  `CHRONICLE_CARE_DAY.md`).
- **Sept 2026 — Home and Care.** The nine-link nav became three sections. Care
  gathers everything about Indigo and the nanny, and the Care Day opened up to
  any hour (not just during a shift). Home became the parents' landing page and
  the place the household-running features land next. The shift-planning
  calendar, which the family never used, left the nav.

The build itself is a human+AI collaboration: ~70 commits on main split almost evenly
between Nick (34) and Claude (36), across ~27 merged PRs whose branch names
(`claude/fix-…`, `claude/visual-design-review-…`) are a log of the Claude sessions
that produced them.

## Core model

**One household, three roles** (stored on `profiles.role`, themed as tarot cards):

| Role | Card name | Can do |
|---|---|---|
| `admin` | The Keeper | Everything family can, plus letting new accounts in (Settings → Accounts) and role changes |
| `family` | The Household | Home; clock the nanny in/out; log the Care Day; write the morning note; record and send payments; manage nannies' accounts, the roster and the Care Sheet |
| `nanny` | The Guardian | Care only (plus own Settings): clock own shifts in/out, log the Care Day, stamp the morning note Seen, see own hours, request payment via Venmo |

Assumptions baked in (fine for now, listed under "gaps" below): one household, one
timezone, a **two-parent** model ("You" / "Partner" in the calendar), and **only one
nanny on the clock at any moment** (enforced in app logic and by a DB index).

**The map** (`src/lib/nav.js`, drawn by `src/lib/Nav.svelte` from the root layout):

| Section | Tabs | Who |
|---|---|---|
| Home `/home` | Hearth · Groceries `/home/groceries` | parents (the nanny is sent to Care) |
| Care `/care` | Today · Journal `/care/journal` · Care Sheet `/care/sheet` · Hours & Pay `/care/hours` | everyone |
| Settings `/settings` | You · Household `/settings/household` · Accounts `/settings/accounts` | everyone; Accounts is parents only |

Signing in lands parents on Home and the nanny on Care → Today. The old
addresses (`/dashboard`, `/tracker`, `/history`, `/chronicle`, `/family`,
`/admin`) redirect to their new homes, so bookmarks keep working.

## Feature inventory (shipped)

### Entry: login and onboarding
- Email/password auth via Supabase. The login screen is styled as tarot card 0 —
  moon-phase crest (the *real* current lunar phase, computed astronomically) with a
  phase meaning as the motto; sign-up is "Light a candle."
- New accounts can't choose their own role. First login routes to **/setup**
  ("Almost in"): the person leaves their name and waits until an admin lets
  them in as family or nanny from Settings → Accounts ("Waiting to be let in").
  Nannies added with "Add a nanny" skip the wait. (Before Sept 2026, /setup let
  anyone pick "Family Member" — see `supabase/household_access.sql`.)

### Home (`/home`) — the household's page
- The parents' landing page: greeting hero with the family pixel painting and
  moon phase; a **Right now** card (`CareGlance.svelte`) — who's on the clock and
  since when, Indigo's day as one status line ("Indigo napping since 1:10 · mac &
  cheese, ate well · 2 potty stars"), and whether the morning note has been seen;
  an **Hours & Pay** card (live "shift in progress" alert, hours today, $ this
  week, unpaid balance); the month calendar; and the painted shelf, which doubles
  as the unpaid-balance tile.
- Live via realtime on `time_entries` and `care_moments`, a 30s poll, and
  refresh-on-tab-focus. The nanny visiting `/home` is sent on to Care.
- Deliberately thin for now: the grocery list, chores, the family calendar and
  Home Assistant tiles land here next (see "Where it may go").

### Home → Groceries (`/home/groceries`) — the grocery lists
- **Lists:** "Groceries" to start; parents add more (Costco, Target, the
  pharmacy) from the "+ List" tab and can delete any but the last. Each device
  remembers which list was open.
- **Aisle sections:** items group by store section — Produce, Meat & Fish,
  Dairy & Eggs, Bakery, Pantry, Frozen, Drinks, Baby, Household, Other — in
  walking order, guessed from the name (`sectionFor` in `src/lib/groceries.js`,
  word-start keyword matching; no manual override yet).
- Tap a row to cross it off: a gilt
  quill inks a line through it (a stand-in for a sprite animation later) and it
  drops into **In the Basket**, where a tap puts it back and **Clear the basket**
  sweeps it away. Every item says who asked for it and when; parents can remove
  a mistake.
- **Quick add:** chips for what the house buys most often (learned from the
  list's own history), then the staples — milk, eggs, ground beef, chicken,
  greens, kale, onions, diapers, wipes, paper towels, toilet paper… — minus
  anything already on the list. The same thing can't be on a list twice
  (DB-enforced, case-insensitive, per list).
- **The nanny adds, doesn't browse:** a "Running Low?" card on Care → Today
  puts things on a list (they pick which when there's more than one); RLS shows the nanny only what they added (waiting,
  or "got it" once bought) and lets them take back their own addition.
- Home's Hearth shows a grocery card with the first few items. Realtime on
  `grocery_items` keeps two phones in step. Nothing is deleted on the way
  through (checked and cleared are timestamps), so the history is there for
  price tracking later.

### Care → Today (`/care`) — the day's care, as it happens
The nanny's landing page, and the parents' when the kids are the business at hand.
Top to bottom:
- **The clock** (`ShiftClock.svelte`): off the clock, a "Clock in" row (the
  nanny clocks their own shifts; a parent clocks a nanny in, picking one if
  there are several). On the clock, a moss strip with the live timer and **Clock out**.
  Confirm modals with editable times (no future times, end after start); stray
  duplicate open shifts are closed at 0 hours on clock-out.
- **Wrap-up at clock-out**: the clock-out prompt arrives **pre-drafted** from the
  shift's moments ("Indigo napped 1:10–2:45 · a meal — mac & cheese, ate well +
  1 snack · 2 potty stars…") with an "in your own words" line to garnish it —
  confirm-and-garnish, never compose-from-scratch. Draft + words become a
  `chronicle_entries` row tagged `wrapup`, linked to the shift; quiet days write
  nothing.
- **The morning note** (`MorningNote.svelte`): parents write/amend one note per
  morning (DB-enforced; after 5pm the button writes tomorrow's). It pins here
  until the nanny taps **Seen ✓**; the receipt (time) shows back to the parents.
- **The day's wrap-up** (`WrapUpCard.svelte`): once the shift closes, today's
  wrap-up shows with a one-tap ♥ for the parents (no comment threads by design).
- **The Care Day** (`CareCockpit.svelte`): kid-face scope chips (when there's
  more than one kid), seven moment buttons (nap / meal / snack / potty / meds /
  note / heads-up) and the day's timeline. **Open to anyone in the household at
  any hour** — a parent can log the 7am dose or a weekend nap. Moments logged
  while a shift runs are tagged with it (so they reach its wrap-up); the rest
  have no shift. The timeline covers the day since midnight, reaching back to
  the running shift's clock-in for an overnight shift. Naps are tap-to-start /
  tap-to-end (with one kid the button ends the nap too) with a DB-enforced
  one-open-nap-per-kid; potty logs tried/success/accident (stars for successes,
  accidents neutral); the Meds button shows the last dose in the past 24 hours
  whoever logged it (the double-dose guard) and suggests recent names; heads-up
  is the ember-flagged tier for parents. Moments are editable by their author or
  family/admin; realtime across devices.

### Care → Hours & Pay (`/care/hours`) — the week, the Purse, the long ledger
- Parents pick whose hours ("Counting hours for"; opens on whoever is on the
  clock, or the nanny named by `?nanny=<id>` from Accounts' Ledger button).
  Parents add/edit/delete **manual entries** (overnight entries supported — an
  end time before the start rolls to the next day).
- **The Week:** Sunday–Saturday navigation, entries table (date, in, out, hours,
  earnings, notes), week total with owed amount and payment status badge, CSV
  export of the week (`timesheet-<nanny>-<week>.csv`).
- **The Purse:** every week's total for the last 26 weeks, paid or not — one
  payment record per nanny per week, DB-enforced. Status is recorded-unpaid →
  paid (or *short*, when hours grew after paying). Parents generate a **Venmo
  payment** (deep link on mobile with prefilled amount and an itemized note —
  week, hours, rate, total; clipboard copy on desktop). The record is written
  *before* the Venmo handoff so bookkeeping never depends on what happens in the
  app. Nannies get the mirror **"Request payment"** flow (a Venmo charge aimed at
  the first parent with a handle on file).
- **All time** (folded in from the old History page): total hours and pay across
  every completed shift, with an all-time CSV export.
- Realtime-synced across devices, with stale-response guards.

### Calendar (`/schedule`) — the shift-planning grid (out of the nav)
Since Sept 2026 this page isn't in the nav — the family never used it — but it
still works at `/schedule` and still feeds the month calendar's shift dots. A
shared family calendar is planned to replace it (see "Where it may go").

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
  (Home, coverage) reads plain shifts. Deleting one occurrence
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

### Settings → Household (`/settings/household`) — the household roster
- The whole household as data — parents, kids, pets — in one `family_members`
  table (Chronicle build step 1: everything the Care Day and Chronicle record
  anchors here). **Members ≠ accounts:** kids and pets never log in; a parent
  row carries a nullable `profile_id` link to their login ("Holds a key"
  badge); caregivers stay in `profiles` (payroll lives there).
- Parents are seeded from existing family/admin profiles by the migration;
  kids and pets are added in the app. The painted kid portraits are stand-ins
  until real ones arrive (their files are named `avatar-jack`/`avatar-emma` —
  placeholders, not the family's names).
- Cards show portrait (avatar_url or a stable painted stand-in; pets get the
  cat sprite), age from birthdate, a kid's *current focus* (the habit that
  will get its own cockpit button), a pet's species, and freeform notes.
- Family/admin get add/edit/remove (kind-specific fields; one member per
  linked account, DB-enforced); the nanny sees the roster read-only.

### Care → Journal (`/care/journal`) — the Chronicle, the family journal
- The memory layer (Chronicle build step 5): wrap-ups arriving on their own at
  clock-out plus written entries (the "pancake Sunday" posts), in a dated feed —
  author avatar and byline, per-date **moon glyph** (the real phase for that
  date), the shift a wrap-up rode in on ("on shift 10:10 AM – 6:40 PM"), kid
  tags with mini portraits, and a one-tap **♥** per entry.
- **Search** (server-side ilike) plus filters by kid, author, and tag; "turn
  back the pages" pagination. Writing offers the four working tags — needs /
  health / milestone / heads-up — and (family/admin only) the **household-only**
  toggle, which hides the entry from the nanny at the RLS layer so parents can
  write candidly.
- **The Needs List**: entries tagged `needs` escape the journal onto a standing
  check-off card until crossed off (which just removes the tag — the entry
  keeps its place in the journal).
- Entries are amendable by their author (or family/admin) and erasable with
  confirm; realtime keeps the feed and hearts live. The `nav-care.png`
  heart-potion finally fronts a page.

### Care → Care Sheet (`/care/sheet`) — the one page a sitter needs
- The reference layer (Chronicle build step 6): **emergency contacts** with big
  tap-to-call `tel:` pills, **authorized pickups** ("no one else — when in
  doubt, call first"), per-kid **allergies** (ember-boxed and plain when
  present — no whimsy in safety paths), the **dosing chart** (which the
  cockpit's last-dose guard complements), **routines**, current focus, and
  freeform **house notes**. A Print button for the fridge copy.
- Parents author it (section-by-section Amend modals); the whole household
  reads it — it exists for the nanny, whose view is read-only. It's a tab in
  Care, and the Care Day's header links here in one tap.
- Data: a DB-enforced singleton `care_sheet` row for household sections, and
  per-kid columns on `family_members` (`allergies`, `dosing`, with `routines`
  holding free text).

### Settings (`/settings`) — You, Household, Accounts
- **You:** profile editing (nannies/admins manage rate + Venmo), password change,
  role display with card title; only admins can change roles.
- **Household:** the roster above.
- **Accounts** (`/settings/accounts`, parents only): nanny accounts (create
  logins, edit rate/Venmo, delete with their entries, jump to their Hours & Pay)
  and — admin only — **Waiting to be let in**, where new sign-ups get a role.

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
| `care_moments` | The Care Day's taps: kind (nap/meal/snack/potty/meds/note/headsup), kid_ids uuid[], shift_id (nullable FK — null when logged with no shift running), started_at/ended_at, payload jsonb | Added by `care_moments.sql`; generated `nap_kid_id` column + partial unique: **one open nap per kid** |
| `chronicle_entries` | The journal's written layer: author, entry_date, body, tags text[], kid_ids uuid[], shift_id, household_only, photo_url | Added by `chronicle_entries.sql`; partial unique: **one 'morning'-tagged note per day**; RLS hides household_only rows from the nanny |
| `chronicle_reacts` | One-tap acknowledgements: (entry_id, user_id, kind 'seen'/'heart') | Same file; each person writes only their own rows — how the nanny stamps Seen without edit rights |
| `care_sheet` | The sitter's reference: contacts jsonb, pickups jsonb, house_notes, updated_at/by | Added by `care_sheet.sql`; a `one boolean` latch enforces the singleton; also adds `allergies` + `dosing` to family_members |
| `grocery_lists` | The lists: name, position, created_by | Added by `grocery_items.sql` (seeds "Groceries"); unique name; everyone reads, parents write |
| `grocery_items` | Things to buy: list_id, name, note, added_by/at, checked_by/at, cleared_at | Same file; partial unique: **one open item per name per list** (case-insensitive); RLS: parents everything, the nanny adds and sees only their own; deleting a list deletes its items |
| `availability`, `schedule_blocks` | Defined in `supabase/schedule.sql` | **Legacy — no longer referenced by code** |

Security: RLS on all tables, set by `supabase/household_access.sql` — reading
or writing anything needs a role (family, admin or nanny), so an account
without one sees nothing; writes also require ownership or family/admin; and a
trigger lets only an admin give out or change a role (parents may create a
nanny's profile). Realtime publication on
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
- **Type:** Cinzel (headings), Cinzel Decorative (wordmark), Alegreya Sans (body
  and every number — lining figures throughout, tabular where digits must align
  or tick). All OFL, self-hosted. The Pixelify Sans "digital" timer face was
  retired in Sept 2026 for readability.
- **Icons as source code:** original line glyphs on a 24-unit grid in
  `src/lib/icons/glyphs.js` (they replaced hand-coded 16×16 pixel sprites that
  blurred at small sizes). New pixel sprites are being sourced for the art slots
  — moment buttons, empty states, portraits.
- **Pixel paintings** (downscaled from 1024px masters): the hearth family scene,
  gilt corner filigree, a three-part painted shelf, still lifes, painted nav
  icons, and **stand-in portraits** (three adults, two kids; the files carry
  placeholder names). A stable hash assigns them as avatar stand-ins.
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
- Overnight shifts work in Hours & Pay manual entry but can't be *scheduled*
  (form requires start < end).
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

*Recent (2026-09-25, the grocery list)*
- Shipped: Home → Groceries with multiple lists, aisle sections, quick-add
  chips, the quill cross-off, the basket, and who-asked-for-it bylines; the
  nanny's "Running Low?" card on Care.
- Migration to run once in Supabase: `supabase/grocery_items.sql` (it also adds
  the table to the realtime publication).

*Recent (2026-09-24, the Home/Care restructure)*
- Shipped: three sections (Home · Care · Settings) with tabs, one nav rendered
  from the root layout; landing by role; redirects from every retired address.
- Shipped: Care → Today — the clock, the morning note, the wrap-up card and the
  Care Day on one page, the Care Day open with no shift running.
- Shipped: Hours & Pay (the Tracker's week and Purse plus History's all-time
  totals); Home with the Right now card; Accounts opened to both parents.
- Fixed along the way: with one kid, tapping Nap again now ends the nap; modal
  sheets no longer slide under the phone's bottom bar (the page container no
  longer makes its own stacking context); the month calendar fits a phone.
- No migrations.

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
- Shipped: the clock-out wrap-up — pre-drafted from the day's moments,
  garnished by hand, saved as a shift-linked Chronicle entry with an evening
  ♥ on the Today card.
- Shipped: the Chronicle page (`/chronicle`) — the journal feed with search,
  kid/author/tag filters, the needs check-off list, hearts, and the
  household-only toggle.
- Shipped: the Care Sheet (`/care`) — contacts, pickups, per-kid allergies +
  dosing + routines, house notes; printable; nanny reads, parents write.
- Migrations to run once in Supabase, in order: `family_members.sql` (seeds
  parent rows from family/admin profiles), then `care_moments.sql`, then
  `chronicle_entries.sql`, then `care_sheet.sql` (add `care_moments`,
  `chronicle_entries` and `chronicle_reacts` to the realtime publication
  alongside them).

## Where it may go (the agreed plan, then speculation — edit me)

**The plan agreed in Sept 2026** — Family Hub as a home hub the family owns (a
Skylight-style kitchen display without buying a Skylight), with Care as one
section of it:
1. **Restructure — done.** Home · Care · Settings (see "The map").
2. **Home basics:** a shared grocery list (**shipped** — `/home/groceries`) and chores (stored in Supabase, so the
   list works at the store), and a shared family calendar that reads the
   family's Google calendars through their private iCal links — the existing
   parser. Moving off Google gradually: Family Hub owns lists and chores from
   day one; the calendar feed can later point at a self-hosted CalDAV (or any
   other provider) without app changes.
3. **Home Assistant** on the Mac mini (Home Assistant OS in a UTM virtual
   machine, with the Tailscale add-on).
4. **A bridge** on the Mac mini that mirrors a short list of devices (thermostat,
   TV, a few lights) into Supabase and runs commands the app writes to a table —
   outbound-only, the HA token never leaves the house, and permissions live in
   RLS (e.g. "the nanny can use the TV only while clocked in"). Locks and cameras
   stay out of the bridge: those go through the Home Assistant app over
   Tailscale.
5. **Kitchen display mode** on the family's 2020 Samsung tablet in a kiosk
   browser, before deciding whether to buy a display.

What the nanny sees of Home (TV controls while clocked in, the grocery list) is
open; the bridge makes it a permission rule, not a rebuild.

**Grocery list, next ideas** (sections and multiple lists shipped; use it a
week or two and let what's annoying pick the next one):
- Recipe book (requested 2026-09-26): save recipes with servings and ingredient
  quantities, then add their ingredients to a grocery list.
- Smarter quick add: "you usually buy milk every 5 days — it's been 6."
- Prices: enter what you paid when crossing off, then spending over time. The
  history is already there (bought items keep their timestamps).
- Receipt photos that fill in the prices.
- Offline at the store, so a weak signal doesn't matter.
- Moving an item to a different aisle section when the guess is wrong.
- The 8-bit look: an Aseprite quill animation and itch.io characters in the
  slot where the gilt quill placeholder is now (`.g-quill` on the list page).
- Multi-family: everything assumes one household today.

**Architecture follow-up (2026-09-26):** Nick wants to discuss the architecture
alongside the latest implementation and this plan. Recipe storage, ingredient
quantities, and the connection to grocery lists are open design questions.

Signals already in the repo: the nav art fronts real pages (nav-home → Home,
nav-care → Care) and the thermometer/droplet/cauldron/clipboard icons serve the
cockpit, with a "rituals" motif still waiting. The name was never "Nanny Hub" —
the childcare-ops core was the first module of something bigger.

**Near term — finish the loop on childcare ops**
- Payment lifecycle: a real requested → paid flow with notifications.
- Recurring shift templates ("every weekday 8–4") and schedule-from-pattern.
- Scheduled calendar sync (cron) + calendar edit/delete parity.
- PWA install + push notifications (shift reminders, "clocked in 10h?" nudges).
- Year-end exports (nanny tax / household employer paperwork from the ledger).

**Next up — designed and specced:** the Chronicle (family journal) and the Care
Day (live shift cockpit) — see **`CHRONICLE_CARE_DAY.md`** for the full agreed
design, data model, and build order. Steps 1–6 have shipped (family_members +
the Family page; the Care Day cockpit; the morning note + Seen receipt + the
live Today card; the clock-out wrap-up; the Chronicle page; the Care Sheet —
since reorganized under Care).
Only step 7 remains — photos via Supabase Storage (which also unlocks real
avatars), then voice capture, both gated on infra/values decisions with Nick.
Kid profile pages (per-kid timelines beyond the chronicle's kid filter) are
the other unbuilt bullet from the screens list.

**Mid term — from nanny ops to family ops** (the drawn-but-unused art's roadmap)
- **Care log:** feeds, naps, temperatures, medicine (thermometer/droplet icons) —
  the nanny's shift becomes a rich handoff note, not just hours.
- **Rituals:** recurring household routines and chores with streaks — bedtime,
  allowance, watering the plants (chores are step 2 of the plan above).
- **Meals:** planning, alongside the shared grocery list (the cauldron).
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

- **Routes:** `/` (login) · `/setup` · `/home` (parents) · `/care` (Today) ·
  `/care/journal` · `/care/sheet` · `/care/hours` · `/settings` ·
  `/settings/household` · `/settings/accounts` (parents) · `/schedule` (out of
  the nav) · `POST /api/calendar/sync`. Retired, redirecting: `/dashboard` →
  Home, `/tracker` → Care, `/history` → Hours & Pay, `/chronicle` → Journal,
  `/family` → Household, `/admin` → Accounts.
- **Key files:** `src/lib/nav.js` (the section/tab map, landing by role) ·
  `src/lib/components/ShiftClock.svelte` · `CareCockpit.svelte` (the Care Day) ·
  `MorningNote.svelte` · `WrapUpCard.svelte` · `CareGlance.svelte` (Home's Right
  now) · `src/lib/time.js` (local-time policy, week bounds) ·
  `src/lib/calendar.js` (unified calendar items + recurrence expansion) ·
  `src/lib/server/ical-parser.js` (ical.js RRULE engine) · `src/lib/venmo.js` ·
  `src/lib/csv.js` · `src/lib/icons/sprites.js` (icon art) · `src/lib/art.js`
  (painting manifest) · `src/app.css` (the entire design system) ·
  `supabase/*.sql` (schema + incident fixes)
- **People:** parents Nick & Rhea; their daughter Indigo; one nanny role with
  rate + Venmo handle. The household roster (kids, pets) lives in
  `family_members`, entered in-app. The painted portraits are stand-ins — their
  files (`avatar-sarah`, `avatar-jack`, `avatar-emma`) carry placeholder names,
  not the family's.
- **Money math:** pay = hours × nanny's `hourly_rate` (fallback 20);
  weeks Sun–Sat local; one payment row per nanny-week.
