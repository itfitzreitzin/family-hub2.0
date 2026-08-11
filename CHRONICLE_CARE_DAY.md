# The Chronicle & The Care Day — Design Spec

> Agreed design from the Aug 2026 planning sessions (Nick + Claude). This is the
> next major build after the schedule tightening. Interactive mockups exist —
> ask Nick for the "Hearth & Hollow — Feature Concepts" artifact link (screens
> III "The Chronicle" and IV "The Care Day") — but this file is self-sufficient.
> Read FAMILY_HUB_OVERVIEW.md first for app context and conventions.

## The idea in one paragraph

The nanny's shift becomes a rich record, not just hours. **The Care Day** is the
live layer: during a shift the Tracker turns into a care cockpit where big
tap-targets log *moments* (nap, meal, potty, meds, note) onto a timeline that
parents watch from an ambient card on the Today page. **The Chronicle** is the
memory layer: those moments plus short written entries accumulate into a
searchable family journal — handoff notes today, the kids' childhood diary in
two years. Core principle: **taps build the day; the wrap-up writes itself.**

## The shape of one day

1. **Morning note (parents → nanny).** Written the night before or that morning;
   pinned at the top of the nanny's shift screen until she taps "Seen ✓" (a
   receipt the parents can see). Kills the morning text thread.
2. **Moments, logged by tap all day** (1–3 taps each, auto-timestamped, editable
   after). Free-text notes can be jotted anytime into the same timeline.
3. **Wrap-up at clock-out.** The clock-out prompt appears **pre-drafted** from
   the day's moments ("1 nap (1:10–2:45) · lunch + 2 snacks · 2 potty stars ·
   park morning") — the nanny confirms and adds a line or two in her own words.
   Confirm-and-garnish, never compose-from-scratch: this is what makes the
   habit survive.

## Moments — each button has a different shape

| Moment | Shape | Details |
|---|---|---|
| **Nap** | duration timer | Tap starts, button shows elapsed, tap ends. Same mechanic/moss styling as the shift timer. |
| **Meal / Snack** | point event | Optional detail sheet: what, ate well / picky. |
| **Potty** | outcome event | Three big options: tried / success / accident. Success gets a tiny celebration; **accidents log neutrally** (readiness data, not failure). |
| **Meds** | safety event | Name (recents pre-filled), dose, time. Button face shows "last dose 2:15" — the double-dose guard (AAP-recommended shared med log). |
| **Note / Photo** | free entry | Text anytime; photo is fast-follow (needs Supabase Storage). |
| **Heads-up** | flagged note | The ONLY tier that pings parents (scraped knee, fever). Everything else waits for pickup. |

**Habit buttons:** each kid can have a *current focus* (Indigo: potty training)
that gets its own button while active, then retires. Parents get a simple
successes-per-day trend view — celebrate the kid, never gamify them.

## Screens by role

- **Nanny on shift (the cockpit):** shift timer shrinks to a strip
  (Pixelify, ≥1.4rem per design-system rule), morning note pinned, kid-face
  selector (per kid / both), moment buttons grid big and thumb-height, live
  timeline below, one-tap Care Sheet link. Art note: `nav-care.png` and the
  droplet / cauldron / thermometer / clipboard icons already exist in
  `static/art` — drawn for exactly this.
- **Parents during the day:** a "The Day — live" card on Today: composed status
  line ("Indigo napping since 1:10 · lunch went fine · 2 potty stars"), the
  feed beneath, one **♥ Seen** react (no comment threads — it's a log, not a
  group chat). Reuses the tracker's realtime channel patterns.
- **Evenings:** wrap-up entry renders in the Chronicle; parents ♥ it.
- **The Chronicle page:** the journal. Entries from wrap-ups AND parent-written
  entries (pancake-Sunday posts), each with author avatar, date, moon glyph
  (moonPhase(date) exists), auto-attached shift for nanny entries. **Search**
  plus filters by kid / author / tag / date. Per-kid timeline pages.
- **Kid pages:** each child is a first-class entity — portrait, age, routines,
  current focus, filtered timeline. (Repo art "Jack"/"Emma" portraits are
  placeholders; real kids include Indigo — get real names/portraits from Nick.)

## Tags that do work (max ~4)

- **Needs** ("out of applesauce") → escapes the journal onto a running
  check-off list until bought. The killer feature.
- **Health** → filterable per kid; med doses timestamped (safety + the
  pediatrician's "how long has this been going on?").
- **Milestone/quote** → feeds a greatest-hits view; keepsake payload.
- **Heads-up** → pings; everything else silent.

## Trust mechanics

- Per-entry **"household only"** toggle so parents can write candidly
  (worries, strategies) without nanny visibility — otherwise they self-censor
  back into SMS.
- Entries append-mostly: author can fix typos; health timestamps stay honest.
- Fold `time_entries.notes` into Chronicle entries (auto-linked to the shift)
  so a day's notes live in ONE place.

## Anti-goals (explicit)

No streaks, no required fields, no guilt for empty days ("the cat keeps the
rest"), no mood analytics, no AI summaries in v1, no comment threads. The nanny
is an employee, not a content creator. Keep whimsy out of money- and
safety-critical paths.

## Voice input

- **v1:** design for dictation — big forgiving textarea, no length limits, a
  mic hint. (Nick uses Wispr Flow, which types into any field already.)
- **Later:** in-app capture → transcription API (OpenAI gpt-4o-transcribe
  ~$0.006/min, or Wispr Flow's API which includes cleanup) → tidied entry +
  extracted structure (needs → list, nap times → moments). Note: this would be
  the app's first runtime third-party service — a deliberate values decision,
  and it's audio of the kids; decide with Nick, don't default into it.

## Data model sketch (follow existing RLS household pattern)

- `children`: id, name, birthdate, portrait/avatar_url, routines jsonb,
  current_focus text, notes.
- `care_moments`: id, shift_id (nullable FK time_entries), author_id, kind
  (nap/meal/snack/potty/meds/note/headsup), kid_ids uuid[], started_at,
  ended_at (naps), payload jsonb (meal detail, potty outcome, med name+dose),
  created_at. Realtime-published for the live parent card.
- `chronicle_entries`: id, author_id, shift_id nullable, kid_ids uuid[], body,
  tags text[], household_only bool, photo_url nullable, entry_date,
  created_at. (Morning notes can be chronicle_entries with a 'morning' tag +
  seen_at, or their own small table — implementer's call.)
- Care Sheet: a `care_sheet` singleton table or jsonb on household — allergies,
  dosing chart, contacts, routines, authorized pickups.
- RLS: reads household-wide (except household_only rows exclude nanny role);
  writes by author or family/admin. Realtime publication like time_entries.

## Suggested build order

1. Schema + `children` (real kids, portraits) — everything anchors here.
2. Cockpit: moment buttons + timeline on the Tracker during an active shift
   (nap timer reuses shift-timer mechanics; DB partial-unique "one open nap
   per kid" like `one_open_shift_per_nanny`).
3. Morning note + Seen receipt; parent live card on Today (realtime).
4. Wrap-up auto-draft at clock-out → creates the Chronicle entry.
5. Chronicle page: feed, search, filters, needs check-off list, ♥ react.
6. Care Sheet page.
7. Photos (Supabase Storage — same unlock enables avatars), then voice.

## Design-system rules that apply (from README + app.css)

Semantic tokens only; moss = active/on-the-clock; ember = danger/heads-up;
labels stay practical, arcana voice lives in ledes and empty states; Pixelify
only for timers ≥1.4rem; tabular-nums for aligned digits; empty states get
illustrated vignettes; every new table ships as a `supabase/*.sql` file with
RLS mirroring existing policies.
