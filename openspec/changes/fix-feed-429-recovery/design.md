## Context

Feed refresh is driven entirely in the browser (`src/feeds/scheduler.ts`). Every 5 minutes, `refreshStaleFeeds` picks feeds where `lastFetched + learnedIntervalMs < now` and fetches each through the stateless `/feed` proxy. `refreshFeed` treats any error identically: it stamps `lastFetched = Date.now()`, doubles `learnedIntervalMs` (cap 24 h), and stores `lastError`. Success is the only way the interval shrinks again, and the cap throttles error-state feeds to at most one attempt per day — so a transient 429 can leave a feed effectively dead (#485). The proxy already passes the upstream status and headers (including `Retry-After`) through unchanged (`server/handle.ts:66-70`), so all the information needed to fix this is already available client-side.

Constraints: IndexedDB-backed storage with no server state; the scheduler only runs while the tab is open and visible (visibility-gated tick, no `visibilitychange` listener — attempts resume at the next tick after a tab becomes visible); sync must not be disturbed; UI surfaces `lastError` in the sidebar.

## Goals / Non-Goals

**Goals:**
- 429s are retried after `Retry-After` (with fallbacks for absent/unparseable values) and never permanently inflate `learnedIntervalMs`.
- Error-state feeds are never retried before `retryAt` (precedence over the learned-interval check) and are retried at a guaranteed floor frequency while the scheduler runs.
- Error state is cleared on first success/304; editing the URL clears it.
- Parse failures are treated as generic errors with the same backoff (they currently hammer every 5 minutes).

**Non-Goals:**
- Changing the `/feed` proxy or server behavior (passthrough already suffices).
- Server-side caching or shared rate-limit state across devices.
- Distinguishing 5xx backoff from 4xx backoff beyond what is already generic; ignoring `Retry-After` on non-429 statuses (e.g. 503) — it is classified as a generic error.
- Syncing error state between devices (decided: local-only, see D5).
- A retry countdown in the sidebar UI (nice-to-have, not in this change).

## Decisions

### D1. Surface 429 details through `FeedFetchResult`

`fetchFeed` (src/feeds/fetch.ts:35-37) currently collapses every non-2xx into `{ kind: 'error', status, message }`. Extend the error variant to carry `retryAfter?: number` parsed from the `Retry-After` header when `status === 429`. The header is already relayed by the proxy, so no server change.

Parsing rule (per spec Req 1): integer seconds → use directly (`Retry-After: 0` is valid and means next tick — do not collapse it as falsy); HTTP-date → `Date.parse`; anything else (absent, non-numeric, unparseable) → treat as absent and use the default fallback. Never store a `NaN` `retryAt` — non-finite values are treated as absent. If the computed date is in the past, schedule at the next tick.

- *Alternative considered*: special-casing a new `kind: 'rate-limited'`. Rejected — an optional field on the existing error variant is smaller and keeps the exhaustive switch simple.
- *Alternative considered*: parsing `Retry-After` server-side and injecting a header. Rejected — the upstream header already passes through; parsing belongs with the client that consumes it.

### D2. Error state takes precedence in staleness gating

Replace the doubling in `refreshFeed` (src/feeds/scheduler.ts:92-95) with a dedicated per-feed error state, `refreshError`, holding `{ retryAt, attempts, lastStatus, lastRetryAfter }`. `lastError` keeps its current role (sidebar message).

Staleness check in `refreshStaleFeeds` becomes, per feed:

```
if (f.refreshError) return f.refreshError.retryAt <= now   // error state gates, takes precedence
if (f.lastFetched == null) return true
return f.lastFetched + f.learnedIntervalMs < now
```

The error state SHALL be checked first and alone: an old `lastFetched` must not make a feed eligible before `retryAt` (this is the fix for the regression where the learned-interval arm would re-trigger every 5-minute tick). Failed attempts update `refreshError.retryAt` only — `lastFetched` is no longer stamped on failure, and `learnedIntervalMs` is never modified by failures. `forceAll` refresh bypasses the gate entirely (existing behavior, user intent).

- *Alternative considered*: reuse `learnedIntervalMs` for backoff as today, but cap lower and decay on success. Rejected — it entangles cadence with failure history, which is exactly the pathology reported.
- *Alternative considered*: keep backoff in memory only. Rejected — a reload would lose the error state and hammer a rate-limited upstream.

### D3. Backoff policy

On any fetch error, compute the next `retryAt`:

- 429 with parseable `Retry-After` → `now + retryAfter`, clamped to `RETRY_AFTER_CLAMP_MS` (24 h). Honoring a clamped `Retry-After` SHALL override the generic-error ceiling: a legitimate long cooldown must not be re-hammered at 6 h.
- 429 with absent/unparseable `Retry-After`, or any generic error (non-429 non-2xx, network error, parse failure) → exponential backoff by attempt count: `min(ERROR_RETRY_FLOOR_MS * 2^(attempts-1), ERROR_RETRY_MAX_MS)` with `ERROR_RETRY_FLOOR_MS = 30 min` and `ERROR_RETRY_MAX_MS = 6 h`.
- `attempts` increments on every recorded failure and is cleared with the error state (on success, 304, or URL edit). It only affects the exponential path; a `Retry-After`-honored failure still increments it for bookkeeping but does not change the scheduled `retryAt`.

Constants live beside the existing interval constants in src/db/types.ts.

- *Alternative considered*: honor `Retry-After` verbatim with no clamp. Rejected — an upstream bug could return absurd values; clamp at 24 h.
- *Alternative considered*: cap generic backoff at 24 h like today. Rejected — violates the guaranteed-floor-frequency requirement (6 h = at least 4 attempts/day).

### D4. Recovery and lifecycle

- Success (200 with parseable body) or 304 → clear `refreshError` and `lastError`.
- On 200-with-parse only: if `learnedIntervalMs` is inflated above `DEFAULT_LEARNED_INTERVAL_MS` (60 min), reset it to the default. Safe because `adaptInterval` (scheduler.ts:156-164) only ever halves or keeps the interval — no legitimate path grows it — so any value above the default is error-inflated. 304 does not touch `learnedIntervalMs`.
- Editing the feed's URL (`changeFeedUrl`, src/feeds/service.ts:82-115) → clear `refreshError` so the new URL isn't gated by backoff accrued against the old URL.
- Parse-failure branch (scheduler.ts:116-120) → record a generic error with backoff instead of today's every-tick hammering.

- *Alternative considered*: only clearing error state on success, leaving URL edits gated. Rejected — the error was about the old URL; gating the new one buys nothing.

### D5. Sync: error state is device-local

Decided (resolving the earlier open question): `refreshError` is local-only, like `lastFetched` and `modifiedAt`. Rate limits are a property of the upstream + this device's proxy/IP, not of a device that wasn't the one rate-limited. Implementation falls out of existing behavior — `applyRemoteState` (src/sync/apply.ts:123-142) merges an explicit field list that does not include `refreshError`, so sync pulls drop it (also dropping `attempts`); `push.ts` only sends enqueued user mutations, and refresh bookkeeping is never enqueued. After a pull drops the error state, the learned-interval arm of the staleness check re-arms the retry floor. No sync code changes expected; task 2.3 is verification + test.

- *Alternative considered*: syncing `refreshError`. Rejected — transient per-device state, would add conflict noise for zero benefit.

## Risks / Trade-offs

- [Regression: error feeds hammered every 5 min via the learned-interval arm] → D2's precedence rule (error state checked first and alone) prevents it; covered by spec scenario "Old lastFetched does not bypass retryAt" and a dedicated unit test.
- [`NaN`/unparseable `Retry-After` dead-ending a feed] → D1 parsing rule treats non-finite as absent and clamps past dates to next tick; covered by spec scenarios and tests.
- [Frequent retries of genuinely dead feeds waste bandwidth/proxy quota] → Max generic retry frequency is 1 per 30 min per feed; concurrency stays at 4.
- [Sync pull silently drops `attempts`, resetting exponential progress] → Acceptable by design (D5); the learned-interval arm keeps the floor, and the feed re-arms backoff on its next failure.
- [`Retry-After` from a misbehaving upstream pins the feed at the clamp] → Clamp caps the damage at 24 h, matching the current worst case, and the retry floor guarantee is explicitly overridden for clamped `Retry-After` per spec.
- [Feeds already stuck at a 24 h `learnedIntervalMs` before this change] → No data migration: `refreshError` starts null; on the next success the inflated interval is reset to default (D4). Until then the feed keeps its current cadence.

## Migration Plan

No schema migration (new field is optional on `Feed`; IndexedDB records are patched in place via `upsertFeed`). Deploy as a normal feature branch + PR; no rollback concerns beyond reverting the change.

## Open Questions

- None blocking. Sidebar retry-countdown display is explicitly out of scope (nice-to-have follow-up).
