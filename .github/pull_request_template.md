## User problem

What observed household behavior or failure does this PR address?

## Approved scope

What single PR slice is implemented?

## Non-goals

What was deliberately not included?

## What changed

Summarize the user-visible behavior and the main technical changes.

## How it works

Trace one representative path:

```text
User action → component → shared/domain logic → Supabase/server → table/RLS → UI refresh
```

## Data, permissions, and migrations

- Tables/columns affected:
- Constraints/indexes:
- RLS/server authorization:
- Migration file and required order:
- Production action required:

Write `None` where applicable.

## Reliability and edge cases

Describe loading, empty, error, stale/offline, double-submit, multi-device, timezone, role/privacy, and wake/focus behavior that applies to this change.

## Validation evidence

- [ ] `npm run check`
- [ ] `npm run lint`
- [ ] `npm run build`
- [ ] Relevant focused tests
- [ ] Manual QA against acceptance criteria
- [ ] Phone screenshot/QA when applicable
- [ ] Desktop screenshot/QA when applicable
- [ ] Physical tablet QA when applicable

Paste exact results or explain any exception; do not write only “tests pass.”

## Manual QA

List numbered steps with expected results and the role/device used.

## Independent review

- Reviewer agent/result:
- Blocking findings resolved:
- Remaining non-blocking findings:

## Risks, limitations, and rollback

What could still fail? How can this change be disabled or reverted safely?

## Production smoke test

What exact flow must be repeated after deployment or migration?

## Nick’s review / learning note

Which two or three files or diff sections did Nick inspect, and what engineering concept did this PR demonstrate?
