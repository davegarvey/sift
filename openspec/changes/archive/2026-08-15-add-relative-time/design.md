## Context

`src/util/time.ts` already ships two time formatters: `relativeTime(ts: number)` (epoch-ms → compact `"2h"`, `"5d"`, `"3w"`) and `humanRelativeTime(date: Date)` (decaying precision: `"2h ago"` → `"last month"` → `"Jun 2026"`, used by the reading byline). Neither takes an ISO date string, and `humanRelativeTime` deliberately loses precision past a few days rather than continuing `"{N}d ago"`.

This change adds a separate pure function in `src/lib/relativeTime.ts` (a new directory) that formats an ISO date string into one of four fixed shapes, with an optional `now` clock parameter so behavior is fully deterministic in tests.

## Goals / Non-Goals

**Goals:**
- Provide `formatRelativeTime(isoDate: string, now?: Date): string` in `src/lib/relativeTime.ts`
- Return exactly one of `"just now"`, `"{N}m ago"`, `"{N}h ago"`, `"{N}d ago"` depending on elapsed time
- Default to the current time when `now` is omitted
- Throw `RangeError` when `Number.isNaN(Date.parse(isoDate))` instead of returning garbage
- Pass `npm test`, `npm run lint`, and `npm run typecheck`

**Non-Goals:**
- Changing or migrating call sites of `relativeTime` / `humanRelativeTime` in `src/util/time.ts`
- Locale-aware output, pluralization, or "just now" alternatives (formats are fixed by requirement)
- Timezone conversion or timezone-aware comparison — offset-bearing timestamps are absolute instants via `Date.parse`; only date-only strings (`YYYY-MM-DD`) get explicit local-midnight normalization (see Decisions)
- Any behavior for dates more than days ago beyond `"{N}d ago"` (no weeks/months/years bucket)

## Decisions

### Rounding at each unit boundary
- **Chosen**: Round elapsed time with `Math.round` at each unit step, mirroring the existing `relativeTime` in `src/util/time.ts`
- **Formula**: `seconds = Math.round((now - date) / 1000)`; `minutes = Math.round(seconds / 60)`; `hours = Math.round(minutes / 60)`; `days = Math.round(hours / 24)`
- **Rationale**: Consistent with the repo's existing convention; `Math.ceil`/`Math.floor` would produce `"0m ago"` or premature `"1d ago"` at boundaries.
- **Consequence (documented)**: elapsed 59.6s rounds to 60 → `"1m ago"` (rounded second count is not < 60), 23.6h rounds to 24 → `"1d ago"` (rounded hour count is not < 24), and exactly 60s → `"1m ago"`, exactly 60min → `"1h ago"`, exactly 24h → `"1d ago"`. Tests pin these boundaries and round-up cases.

### Bucket thresholds
- `seconds < 60` → `"just now"`
- `minutes < 60` → `"{N}m ago"`
- `hours < 24` → `"{N}h ago"`
- otherwise → `"{N}d ago"` (uncapped — a 400-day-old date reads `"400d ago"`)

### Invalid input handling
- **Chosen**: Throw `RangeError` when `Number.isNaN(Date.parse(isoDate))`; any string `Date.parse` accepts is valid input
- **Rationale**: `Date.parse` is the standard, engine-consistent gate and makes the validity definition exact ("underdefined" no longer). It is the same parse semantics as `new Date(isoDate)`. `RangeError` is the standard built-in error for invalid date values.
- **Consequence (documented)**: `Date.parse` silently rolls over invalid calendar dates (`"2026-02-31"` → 2026-03-03) and accepts some legacy non-ISO formats (`"August 15, 2026"`). Both are accepted by design with pinned test results — nothing is silent. Implementing strict ISO-8601 validation is out of scope.

### Date-only strings
- **Chosen**: A date-only string (`YYYY-MM-DD`, no time component) SHALL be interpreted as local midnight of that calendar day, constructed from its components (`new Date(y, m - 1, d)`) rather than via `Date.parse`, which yields UTC midnight
- **Rationale**: A calendar date carries no instant; UTC-midnight parsing makes the same string land in different buckets by caller timezone (e.g. `"2026-08-15"` reads `"22h ago"` in UTC+2 but `"1d ago"` in UTC−5). Local midnight is the user-facing interpretation ("today" → `"just now"`) and is deterministic across timezones.
- **Alternative considered**: Reject date-only strings. Rejected — the requirement accepts "ISO date string" input, and throwing on a valid ISO date would be surprising.
- **Note**: offset-bearing timestamps (e.g. `"2026-08-15T00:00:00+05:30"`) are absolute instants under `Date.parse`; no timezone handling is needed for them.

### Injectable clock
- **Chosen**: Optional `now: Date` parameter, defaulting to `new Date()` when omitted
- **Rationale**: Keeps the function pure and makes unit tests deterministic without fake timers.

### Future dates
- **Chosen**: A date in the future yields negative elapsed time, which is `< 60` seconds → `"just now"`
- **Rationale**: Natural consequence of the comparison order; no special handling needed.

## Risks / Trade-offs

- **Uncapped day count**: very old dates read awkwardly ("400d ago"). Accepted — the requirement explicitly says "Otherwise → `{N}d ago` (days)" with no upper bound.
- **Rounding vs truncation**: `"1m ago"` may appear for dates slightly under a minute (59.6s) and `"1d ago"` for dates slightly under a day (23.6h). Accepted for consistency with the existing formatter; tests pin the behavior.
- **`Date.parse` permissiveness**: invalid calendar dates roll over (`"2026-02-31"` → Mar 3) and legacy non-ISO formats are accepted. Accepted by design — validity is pinned to `Number.isNaN(Date.parse(isoDate))` and the edge behavior is covered by tests; strict ISO-8601 validation is out of scope.
- **New `src/lib/` directory**: introduces a new top-level source directory. Keep it minimal — this change adds only the one file there.

## Open Questions

None resolved during design.
