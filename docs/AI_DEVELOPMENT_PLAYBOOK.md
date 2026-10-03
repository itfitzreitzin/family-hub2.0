# Family Hub AI Development Playbook

This playbook turns Claude Fable 5 from a one-shot code generator into a small, reviewable software team that also teaches Nick how the app works.

## The team

| Role | Runs where | Can edit? | Primary responsibility |
|---|---|---:|---|
| **Nick — Product owner** | Real household + GitHub | Approves | Chooses the problem, scope, and whether a result is useful |
| **Lead/teacher** | Main Claude Code session | Yes, when asked | Coordinates the workflow, preserves shared context, and explains decisions |
| **product-coach** | Project subagent | No | Converts observed behavior into a testable brief |
| **architect-teacher** | Project subagent | No | Inspects the repo and proposes the smallest safe design and PR sequence |
| **feature-builder** | Project subagent | Yes | Implements one approved slice and shows Nick how it works |
| **reviewer-qa** | Project subagent | No | Independently reviews the diff, runs checks, and recommends whether to merge |

The team is intentionally small. More agents do not automatically produce better software; they add coordination cost and can duplicate work or edit the same files.

## Stable default: subagents in sequence

Use project subagents for normal work. They run in isolated context windows, return a focused result to the main session, and have role-specific tool permissions. The main session remains the lead.

The default sequence is:

```text
Observed household problem
        ↓
product-coach brief
        ↓
Nick approves behavior
        ↓
architect-teacher plan
        ↓
Nick approves PR 1
        ↓
feature-builder implementation
        ↓
reviewer-qa independent gate
        ↓
Nick tests preview on the real device
        ↓
Draft PR → merge → production smoke test
```

Do not collapse those steps into “build this whole idea” for meaningful features.

## First-time setup

1. Update Claude Code and verify the installed version:

   ```bash
   claude update
   claude --version
   ```

2. Start Claude Code from the repository root:

   ```bash
   cd family-hub2.0
   claude
   ```

3. Because `.claude/agents/` is new to this repository, restart the Claude Code session once after this setup branch is merged if the agents do not appear immediately.

4. In Claude Code, type `@` and verify these project agents appear:

   - `product-coach`
   - `architect-teacher`
   - `feature-builder`
   - `reviewer-qa`

The agent definitions are checked into `.claude/agents/`, so they travel with the project and can be improved through normal pull requests.

## The workflow in practice

### Phase 1 — Start with observed behavior

Write what actually happened, not the feature you already decided to build.

Good:

> Rhea does not open the web app. She will glance at something already visible in the kitchen, and the Care Sheet is useful when she reaches it.

Weak:

> Build an AI-powered family command center with smart-home controls.

Invoke the product coach:

```text
@product-coach Turn this observed household problem into the smallest testable feature brief. Do not design the architecture or write code. Challenge me if a manual or native-device solution would test it first.

[describe what happened]
```

Read its output and change the brief until the acceptance criteria describe behavior you could personally observe.

### Phase 2 — Approve behavior before architecture

Nick should be able to answer:

- Who is using this?
- At what moment?
- What is the smallest useful action?
- What does success look like in the house?
- What are we explicitly not building?

Only then invoke the architect:

```text
@architect-teacher Inspect the current repository against this approved brief. Do not edit files. Map the current data flow, show what can be reused, identify schema/RLS implications, and propose small PR slices. Teach me the main architecture concept and stop after recommending PR 1.

[approved brief]
```

Ask follow-up questions until you understand these four things:

1. Which screen/component receives the action?
2. Which shared module owns the rule?
3. Which server or Supabase operation stores or retrieves it?
4. Which table, constraint, and RLS policy protect it?

### Phase 3 — Create a focused branch

One issue or approved brief should produce one focused branch/PR slice.

Suggested branch names:

```text
feature/tablet-display-shell
feature/household-notes
fix/calendar-focus-refresh
refactor/extract-note-loader
```

Never begin feature implementation on `main`.

### Phase 4 — Implement only one approved slice

Invoke the builder with the approved plan and explicit boundaries:

```text
@feature-builder Implement PR 1 from the approved architecture plan only. Do not commit or push. Stop if the code contradicts a material plan assumption. Run the required checks, give me a manual QA script, and walk me through one complete code path afterward.

[PR 1 plan and acceptance criteria]
```

While it works, pay attention to the files named in its pre-edit summary. Those are the files you will inspect in the diff.

### Phase 5 — Read the diff before asking whether it works

In GitHub or your editor, inspect:

- Which files changed?
- Was a new dependency added?
- Was a migration added?
- Was existing behavior copied into a new page?
- Are unrelated files included?
- Is there a surprisingly large component?

You do not need to understand every line. Trace one path and ask what each layer is responsible for.

### Phase 6 — Independent review

The builder does not approve its own work.

```text
@reviewer-qa Review this branch against main and the approved brief. Do not edit files. Run the checks, inspect every migration/RLS policy, test the acceptance criteria skeptically, and tell me what blocks merge. Show me the two or three diff sections I should read myself.
```

Resolve blocking findings through a new, tightly scoped builder task. Then run the reviewer again.

### Phase 7 — Real-device QA

A responsive browser screenshot is not proof of refrigerator-tablet usability.

For tablet/display work:

- Open the preview on the actual tablet.
- Mount or place it at the intended height and distance.
- Test it while holding Indi or carrying something.
- Put the browser to sleep and wake it later.
- Disconnect/reconnect Wi-Fi.
- Leave the page open for hours.
- Ask whether Rhea notices or uses it without repeated prompting.

Record failures as: **step + expected + observed + visible error/toast + screenshot**.

### Phase 8 — Draft PR, merge, and production smoke test

A draft PR should explain:

- User problem and approved scope
- What changed and what did not
- Data/RLS implications
- Validation evidence
- Manual QA results
- Migration steps
- Risks, limitations, and rollback
- What Nick learned/reviewed

After merge and deployment, repeat the critical flow in production. Preview success does not prove production migrations or RLS are correct.

## Learning loop for every PR

For each change, Nick should leave with one answer in each category:

### Product

What real behavior are we trying to change?

### Frontend

Which component owns the interaction and visible state?

### Domain logic

Where is the reusable rule or transformation?

### Data/backend

Which query, endpoint, table, constraint, and RLS policy are involved?

### Reliability

What happens if the network, realtime update, user input, or another device behaves unexpectedly?

### Git

What does this diff change, and how would we revert it?

Keep a short note in the PR rather than trying to memorize syntax.

## Agent teams: optional, experimental, and mostly for debate

Claude Code also supports experimental **agent teams**, where separate sessions share a task list and can message one another. They use substantially more tokens and have coordination limitations. Do not use them for every feature.

Use a team when independent perspectives genuinely need to challenge one another, such as:

- Product/UX versus architecture versus a skeptical reviewer before a major feature
- Competing hypotheses for a difficult bug
- Parallel review of security, performance, and tests
- Research across clearly separate frontend, database, and integration areas

Do not use a team when:

- Work is sequential
- Several agents would edit the same files
- The change is small
- The product decision is not yet clear
- One agent could inspect and report the result

To try teams locally, use a local (not committed) Claude setting or environment variable:

```json
{
  "env": {
    "CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS": "1"
  }
}
```

Start with three teammates and **research/review only**. Example:

```text
Create an agent team for Tablet Display v1 discovery. Use three teammates named product, architect, and skeptic. No code changes. Have product define the smallest household behavior, architect map reuse and risks in the repo, and skeptic challenge whether the feature will be used. Require the three to share findings, then have the lead synthesize one recommendation and shut the team down.
```

For risky work, require plan approval before any teammate edits. Avoid parallel edits to the same file. Ask the lead to shut down teammates and clean up the team when finished.

## What not to delegate

Nick retains these decisions:

- Whether a household problem is worth solving
- Whether the proposed workflow feels natural
- Whether a dependency or external service is acceptable
- Whether a migration may run in production
- Whether the preview worked on the physical device
- Whether a PR merges
- Whether the feature stays after real use

Agents can provide evidence and recommendations. They do not experience the household.

## Current training project: Tablet Display v1

Use the tablet display as the first full pass through this workflow.

### Product experiment

Can an always-visible refrigerator surface help the household without requiring Rhea to remember to open the full app?

### Planned slices

1. **Read-only display shell:** existing Today/calendar/shift/care data presented for landscape tablet use; no new note schema.
2. **Household quick notes:** capture, display, acknowledge/complete, RLS, and realtime/focus refresh.
3. **Appliance behavior:** wake/focus recovery, stale/offline state, auto-return, safe shared-display permissions, and PWA/fullscreen behavior where justified.
4. **Real-device correction:** only changes supported by actual refrigerator-tablet use.

Do not implement all four in one PR.

## Definition of done

A slice is done only when:

- The acceptance criteria have evidence.
- `npm run check`, `npm run lint`, and `npm run build` were run or any exceptions are explained.
- New data has constraints and RLS.
- Loading/error/stale/multi-device behavior is addressed where relevant.
- The independent reviewer has no blocking findings.
- Nick can explain one representative code path.
- Device-specific work has been tested on the intended device.
- The PR documents migration, production smoke test, limitations, and rollback.
