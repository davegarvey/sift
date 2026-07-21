## Context

Sixteen independent small fixes and cleanups across the codebase, identified by a holistic code review and then refined by a red-team sub-agent. Most are one- to five-line changes touching separate modules. The only cross-cutting concern is the IndexedDB schema migration (items 3 + 4 share a DB_VERSION bump).

## Goals / Non-Goals

**Goals:**
- Fix 3 correctness bugs (etag middleware, cron unit mismatch, dead index)
- Improve performance in 2 areas (feeds URL lookup, schema init batching)
- Remove 4 instances of dead code
- Add 3 targeted console.warn calls for debuggability
- Harden 3 config/best-practice areas (deploy safety, sourcemaps, wrangler date)

**Non-Goals:**
- No behavioral changes beyond the bugfixes
- No new features or capabilities
- No refactoring beyond what's listed

## Decisions

- **Items 3 + 4 share a single DB_VERSION bump (5→6).** Both touch the IDB schema; separate bumps would force users through two sequential migration handlers. Combined into one `_oldVersion < 6` block.
- **Item 7 dropped.** Red team correctly identified the eviction code already filters via cursor — the proposal was based on a misreading.
- **Item 12 scoped to 3 catch blocks only.** Remaining silent catch blocks (`env.ts`, `extract.ts`, `discover.ts`, `apply.ts`) are intentionally silent — they guard expected non-error conditions (missing .env, malformed URLs in wild HTML). Adding noise would reduce signal.
- **Item 15 targets `2026-01-01`.** Midpoint between the current `2024-12-01` and today. Review of workers compat dates between these dates shows no breaking changes affecting this codebase (no D1 API changes, no fetch/streaming changes).
- **Item 17 (remove empty `_oldVersion < 4` handler) grouped with schema changes** since it's in the same function.

## Risks / Trade-offs

- **[IndexedDB migration] If the v5→6 migration fails mid-way**, the user's database is in an inconsistent state. Mitigation: the upgrade handler runs inside an IndexedDB transaction — if any operation throws, the entire upgrade is rolled back and the app falls back to the old version on next load.
- **[Cron fix] Changing the cron comparison from ms→ms to s→s** means the first run after deploy may not clean up accumulated expired codes. This is benign — the grace period mechanism is unchanged, just the unit comparison is corrected.
- **[Proxy cache headers] Adding `no-store`** prevents any intermediate caching of feed/article responses. This is the correct default for a proxy that carries encoded upstream URLs in query strings.

## Migration Plan

- All changes are backward-compatible. No data migration required beyond the IDB version bump.
- `npm run build && npm run typecheck` validate the build. `npm run test` validates existing tests pass.
- Deploy via existing `npm run deploy` workflow (the `--ff-only` change in item 13 makes the deploy path safer).

## Open Questions

- *(none resolved)*
