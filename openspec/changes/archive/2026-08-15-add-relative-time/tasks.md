## 1. Implement `formatRelativeTime`

- [x] 1.1 Create `src/lib/relativeTime.ts` exporting `formatRelativeTime(isoDate: string, now?: Date): string`
- [x] 1.2 Buckets: `"just now"` (< 60s), `"{N}m ago"` (< 60min), `"{N}h ago"` (< 24h), `"{N}d ago"` (otherwise), using `Math.round` at each unit step
- [x] 1.3 Default `now` to the current time when omitted
- [x] 1.4 Throw `RangeError` when `Number.isNaN(Date.parse(isoDate))`; accept any string `Date.parse` accepts (including rolled-over calendar dates like `"2026-02-31"`)
- [x] 1.5 Normalize date-only strings (`YYYY-MM-DD`) to local midnight via component construction (`new Date(y, m - 1, d)`), not `Date.parse`'s UTC midnight

## 2. Unit tests

- [x] 2.1 Add `tests/relativeTime.test.ts` covering, with a fixed `now`:
- [x] 2.1.1 seconds bucket → `"just now"`
- [x] 2.1.2 minutes bucket (5 minutes) → `"5m ago"`
- [x] 2.1.3 hours bucket (3 hours) → `"3h ago"`
- [x] 2.1.4 days bucket (2 days) → `"2d ago"`
- [x] 2.1.5 boundary values (60s, 60min, 24h) → `"1m ago"`, `"1h ago"`, `"1d ago"`
- [x] 2.1.6 rounding pins: 59.6s → `"1m ago"`, 23.6h → `"1d ago"`
- [x] 2.1.7 default `now` path: fixture 30s in the past (`new Date(Date.now() - 30_000).toISOString()`) → `"just now"` (comfortable margin so the test is not racy)
- [x] 2.1.8 invalid date string (`"garbage"`) → throws `RangeError`
- [x] 2.1.9 future date → `"just now"`
- [x] 2.1.10 date-only `"2026-08-15"` with `now` = local 10:00 on 2026-08-15 → `"10h ago"` (local midnight, not UTC)
- [x] 2.1.11 non-UTC offset: `"2026-08-15T00:00:00+05:30"` with `now` = `"2026-08-15T10:00:00+05:30"` → `"10h ago"`
- [x] 2.1.12 rolled-over calendar date `"2026-02-31"` with `now` = local 10:00 on 2026-03-03 → `"10h ago"` (no throw)
- [x] 2.1.13 non-ISO string `"15/08/2026"` → throws `RangeError`

## 3. Verification

- [x] 3.1 `npm test` — all tests pass
- [x] 3.2 `npm run lint` — zero warnings
- [x] 3.3 `npm run typecheck` — zero errors
