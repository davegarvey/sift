## Why

A feed that receives a 429 (or any persistent upstream error) gets pinned in an error state: each failure doubles `learnedIntervalMs` up to a 24 h cap and stamps `lastFetched`, so the feed is retried at most once per day and never returns to its normal cadence — it can stay dead for days even after the upstream stops rate-limiting. Reported in #485.

## What Changes

- Treat 429s distinctly from other errors: read the upstream `Retry-After` header (already passed through by the `/feed` proxy) and schedule the next attempt accordingly, with a sane fallback when absent or unparseable.
- Separate error backoff from the learned refresh cadence. A transient failure must not permanently inflate `learnedIntervalMs`; an error-inflated interval is reset on the next successful fetch.
- Error-state feeds are never retried before their scheduled `retryAt`, and are retried at a guaranteed floor frequency (while the app is running, i.e. a tab is open and visible) so they self-recover without user intervention.
- Error state is device-local (not synced), survives reloads, and is cleared on the first successful fetch (or 304). Editing a feed's URL clears its error state so the new URL isn't gated by the old backoff.
- Surface 429/Retry-After information through `FeedFetchResult` so the scheduler can act on it. Parse failures are treated as generic errors and subject to the same backoff (no more 5-minute hammering of malformed feeds).

## Capabilities

### New Capabilities
- `feed-refresh-retry`: refresh scheduling behavior for feeds in error states — error classification, `Retry-After` handling, bounded error backoff, guaranteed retry floor, and recovery to the normal cadence.

### Modified Capabilities
<!-- none: feed refresh behavior is not currently specced -->

## Impact

- `src/feeds/fetch.ts` — `FeedFetchResult` gains status/Retry-After info for 429s.
- `src/feeds/scheduler.ts` — error handling in `refreshFeed`, staleness gating in `refreshStaleFeeds`; error backoff no longer mutates `learnedIntervalMs`; parse-failure branch backs off like other errors.
- `src/db/types.ts` — new optional `refreshError` field on `Feed`; new backoff constants.
- `server/handle.ts` — no change expected (already passes upstream status + headers through).
- Sync — `refreshError` is local-only: sync pull/push must not carry it.
- Tests: new unit tests for backoff/recovery logic; existing scheduler behavior preserved.
