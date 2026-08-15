## Why

The UI displays publication timestamps in several places, but there is no single, testable helper that formats an ISO date string as a short relative time ("5m ago", "3h ago", "2d ago"). The existing utilities in `src/util/time.ts` take epoch numbers (`relativeTime`) or `Date` objects with decaying precision (`humanRelativeTime`), not ISO strings, and neither exposes an injectable clock. A pure, deterministic formatter is needed so relative timestamps are consistent and unit-testable without mocking the clock.

## What Changes

- Add a pure function `formatRelativeTime(isoDate: string, now?: Date): string` in a new file `src/lib/relativeTime.ts`
- Output buckets:
  - less than 60 seconds ago → `"just now"`
  - less than 60 minutes ago → `"{N}m ago"` (e.g. 5 minutes → `"5m ago"`)
  - less than 24 hours ago → `"{N}h ago"`
  - otherwise → `"{N}d ago"` (days)
- Use `now` when provided, otherwise the current time
- Throw `RangeError` when `isoDate` cannot be parsed as a date
- Add unit tests in `tests/relativeTime.test.ts` covering each bucket and the invalid-date case

## Capabilities

### New Capabilities
- `relative-time`: Pure ISO-date → relative-time formatting with an injectable clock and `RangeError` on invalid input.

### Modified Capabilities
None — this is a new capability.

## Impact

- `src/lib/relativeTime.ts` (new) — the `formatRelativeTime` function
- `tests/relativeTime.test.ts` (new) — unit tests for each bucket, the default-clock path, and the invalid-date case
- No existing call sites change; `src/util/time.ts` is untouched and consumers can adopt the new helper later
