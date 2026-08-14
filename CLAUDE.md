# Family Hub — Claude Project Instructions

Read these before substantial work:

- @README.md
- @FAMILY_HUB_OVERVIEW.md
- @docs/AI_DEVELOPMENT_PLAYBOOK.md
- @CHRONICLE_CARE_DAY.md only when the work touches care, handoffs, the Chronicle, or memories

## Product charter

Family Hub is a private, one-household operating system. It should reduce real coordination work for Nick, Rhea, caregivers, and eventually people caring for the pets or home. It is not a generic SaaS product and does not need feature parity with commercial family-calendar apps.

Current product direction:

- **Today** answers what matters now, what happens next, and what needs attention.
- **Calendar** coordinates schedules, childcare coverage, appointments, and shifts.
- **Care** contains practical notes, handoffs, care sheets, care history, and an easy journal/memory layer.
- **Home** will eventually expose meaningful smart-home states and routines, not a wall of device controls.
- **Money** covers nanny time and pay before any broader household-finance expansion.
- The Chronicle remains useful, but ordinary care information should be captured once and become history or a memory with little additional work.
- The current product experiment is a refrigerator/tablet display that people can glance at without remembering to open the full app.

Do not add AI transcription, smart-home integrations, meal planning, chores, or another major navigation destination until the current experiment has demonstrated household use.

## Team workflow

The main Claude session is the **team lead and teacher**. It owns coordination and presents decisions to Nick. Use the project agents in this order for meaningful feature work:

1. `product-coach` turns an observed problem into a small feature brief, acceptance criteria, and non-goals.
2. `architect-teacher` inspects the current implementation and proposes the smallest safe design and PR sequence.
3. Nick approves the intended behavior and the first PR slice.
4. `feature-builder` implements only that approved slice.
5. `reviewer-qa` independently reviews the diff, runs checks, and produces an evidence-based merge recommendation.
6. Nick tests the preview on the real device before merge when the feature is device- or workflow-specific.

Do not skip product and architecture review for changes involving schema, RLS, authentication, calendar logic, time/pay, care/health records, home access, or external APIs.

## Teaching contract

Nick is learning application development while building this project. Do not hide the engineering behind a finished result.

Before implementation:

- Explain the user flow in plain language.
- Show the data flow: interaction → component → shared module → Supabase/server → table/RLS → UI refresh.
- Name the main files and tables involved.
- Identify the most important tradeoff.

After implementation:

- Walk through one representative code path.
- Explain one engineering concept demonstrated by the change.
- Give Nick two or three specific files or diff sections to inspect.
- State what was tested, what was not tested, and what could still fail.

Avoid unexplained jargon. Define a term the first time it matters.

## Engineering rules

- Never work directly on `main`. Use a focused branch and a draft pull request.
- One PR should have one coherent purpose. Do not combine a redesign, schema migration, unrelated refactor, and new feature.
- Reuse existing domain logic. Do not copy calendar, local-time, shift, pay, care, or note rules into another page.
- Keep UI components focused on rendering and interaction. Put reusable business/data behavior in shared modules.
- Follow the existing device-local-time policy in `src/lib/time.js`. Do not improvise ISO/UTC conversions in page components.
- Every new table or sensitive column requires a checked-in `supabase/*.sql` migration, constraints, indexes where justified, and RLS.
- Hiding a button is not authorization. Enforce permissions in RLS or server code.
- Browser code must never contain service-role keys, transcription keys, smart-home credentials, or other secrets.
- External services and new runtime dependencies require explicit approval and a reason they are necessary.
- Use refactor-as-touched: improve the part required by the feature, but do not launch an unrelated rewrite.
- Do not hardcode household names, rates, roles, IDs, dates, or devices in business logic.
- Account for loading, empty, error, stale, offline, double-submit, and multi-device states where relevant.
- Do not run production migrations, mutate production data, commit, push, merge, or deploy unless Nick explicitly requests that action.

## Required validation

Run the checks relevant to the change and report exact results:

```bash
npm run check
npm run lint
npm run build
```

Add narrower tests when a change introduces reusable calculations or a critical invariant. A passing build alone is not proof of correct behavior.

For each PR, provide:

- A manual QA script tied to the acceptance criteria.
- Screenshots for visible desktop, phone, and tablet changes as applicable.
- Migration and production-smoke-test instructions when data or permissions changed.
- A rollback path and known limitations.
