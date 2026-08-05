## 1. Fetch layer

- [x] 1.1 Extend `FeedFetchResult`'s error variant in `src/feeds/fetch.ts` with `retryAfter?: number`, parsed from the `Retry-After` header only when status is 429: integer seconds used directly (`0` is valid), HTTP-date via `Date.parse`, non-numeric/unparseable treated as absent (never `NaN`)

## 2. Data model

- [x] 2.1 Add optional `refreshError` field to the `Feed` type in `src/db/types.ts` (holding `retryAt`, `attempts`, `lastStatus`, `lastRetryAfter`)
- [x] 2.2 Add `ERROR_RETRY_FLOOR_MS` (30 min), `ERROR_RETRY_MAX_MS` (6 h), `RETRY_AFTER_CLAMP_MS` (24 h), and default-fallback constants beside the existing interval constants
- [x] 2.3 Verify sync paths treat `refreshError` as local-only: `src/sync/apply.ts` explicit-field merge drops it, `src/sync/push.ts` never enqueues it; add a test for pull-during-backoff

## 3. Scheduler

- [x] 3.1 Update `refreshStaleFeeds` in `src/feeds/scheduler.ts`: when `refreshError` is set, staleness is `retryAt <= now` alone — checked first, taking precedence over the learned-interval arm (regression guard for the 5-min hammering case)
- [x] 3.2 Replace the `learnedIntervalMs` doubling on error in `refreshFeed` with `refreshError` bookkeeping: 429 honors parsed `Retry-After` clamped to 24 h (clamp overrides the 6 h generic ceiling); generic errors (non-429 non-2xx, network, parse failure) use attempt-based exponential backoff between 30 min floor and 6 h max; stop stamping `lastFetched` on failure
- [x] 3.3 Apply backoff to the parse-failure branch (scheduler.ts:116-120) so malformed-feed 200s no longer fetch every tick
- [x] 3.4 Clear `refreshError` on success (200 + parse) and 304; on 200-with-parse only, reset an inflated `learnedIntervalMs` (above `DEFAULT_LEARNED_INTERVAL_MS`) to the default; 304 leaves the interval unchanged
- [x] 3.5 Clear `refreshError` when the feed URL is edited (`changeFeedUrl` in `src/feeds/service.ts`)
- [x] 3.6 Confirm force-refresh (`forceAll`) still bypasses `retryAt` and re-records backoff on failure

## 4. UI (optional polish)

- [x] 4.1 Surface next-retry countdown from `refreshError.retryAt` in the existing sidebar error display (nice-to-have, not spec-required)

## 5. Tests

- [x] 5.1 Unit tests: `fetchFeed` parses `Retry-After` as integer seconds, HTTP-date, `0`, absent, and garbage (never `NaN`)
- [x] 5.2 Unit test: feed with old `lastFetched` and pending `retryAt` is not attempted before `retryAt` (precedence regression test)
- [x] 5.3 Unit tests: error backoff does not modify `learnedIntervalMs`; exponential path stays within 30 min floor / 6 h max; clamped `Retry-After` overrides the 6 h ceiling
- [x] 5.4 Unit tests: success and 304 clear `refreshError`; inflated `learnedIntervalMs` reset on 200-with-parse only; parse failures use generic backoff
- [x] 5.5 Unit test: URL edit clears `refreshError`; sync pull drops it (see 2.3)
- [x] 5.6 Run `npm run typecheck`, `npm run lint`, and `npm test` with zero failures
