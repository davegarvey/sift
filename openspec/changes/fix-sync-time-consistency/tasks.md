## 1. Server: monotonic wall clock

- [x] 1.1 Rework `server/sync/monotonic.ts` with single atomic statements: `nextMonotonicTime` = `UPDATE counters SET value = CASE WHEN value + 1 > ? THEN value + 1 ELSE ? END WHERE name = 'server_time' RETURNING value` (bind wall twice); `currentMonotonicTime` = `UPDATE counters SET value = CASE WHEN ? > value THEN ? ELSE value END ... RETURNING value` (persists the wall bump — a later batch must never stamp below a reported serverTime)
- [x] 1.2 Extend the dev shim `server/sync/local-d1.ts` for the counters `value = CASE WHEN value + 1 > ? ...` form (compute `max(current + 1, param)`); verify the generic `_applyCase` does not mis-write
- [x] 1.3 Add miniflare D1 tests (NOT shim tests): strictly increasing under clock regression; anchored to `Date.now()` scale; `batchT >= serverTime` across concurrent push/pull

## 2. Server: row_at = server batch time

- [x] 2.1 Call `nextMonotonicTime` **before building statements** in the push handler (currently computed at the end and discarded via `void maxAt`); bind `batchT` for every `row_at` write: target feed rows, flag rows, and the D5 sibling UPDATE's `row_at` CASE (a client-stamped sibling row_at can fall below another device's cursor and be silently missed forever)
- [x] 2.2 Change the pull query to `row_at >= since` (inclusive — heals the same-ms push/pull interleave; cursor strictly advances so delivery stays exactly-once)
- [x] 2.3 Exclude tombstones from the feed row-cap count (`AND deleted = 0`)
- [x] 2.4 Add D1 integration tests (miniflare): all rows in one batch share one `row_at` (including sibling-tombstoned rows); rows stamped at the cursor value are delivered once then never again; pre-change cursor (`since = 1`) gets one full dump then incremental; tombstone churn does not trip the feed cap

## 3. Client: server-clock offset

- [x] 3.1 Add `sync_server_offset` meta key handling in `src/sync/key.ts` (get/set/clear); clear it on toggle-off alongside `lastSyncAt`
- [x] 3.2 Measure the offset in `src/sync/merge.ts` on every successful pull — the full and empty-payload paths of `runPull`, and `runFirstTimeSetup` — as `serverTime - Date.now()` at response receipt, **before** calling `applyRemoteState`, and pass it to the apply step
- [x] 3.3 Outgoing conversion in `src/sync/push.ts` `chunkToBody`: every emitted `at` (feed-upsert folderAt/titleAt/feedUrl.at/htmlUrl.at/tagsAt/deletedAt, feed-delete feedUrl.at + at, flag readAt/starredAt) becomes `at + offset`; offset 0 when unset
- [x] 3.4 Incoming conversion in `src/sync/apply.ts`: one top-of-function pass converting every remote numeric stamp (`feed_url_at`, `folder_at`, `title_at`, `html_url_at`, `tags_at`, `deleted_at`, `row_at`) to the local frame (`stamp - offset`) before all comparisons (`newer()`, the tombstone rule) and before storing merged per-field timestamps; flag stamps need no incoming conversion (outgoing-only)
- [x] 3.5 Unit tests: sign correctness (a +5s-clock device pushes stamps the server sees as consistent; a −3s device applies tombstones correctly — including on its FIRST pull); empty-pull updates the offset; offset cleared on toggle-off

## 4. Tests

- [x] 4.1 E2E skewed-clock convergence (`sync-pairing-e2e` pattern): device A clock +5s and device B clock −3s both push and pull edits/deletions; assert LWW decisions match wall-clock reality (newer edit wins, tombstone applies/keeps per the deletion rule)
- [x] 4.2 Verify all existing sync tests still pass (row_at assertions in `sync-d1`, cursor behavior in pairing e2e, shim smoke tests)
- [x] 4.3 Run `npm run typecheck`, `npm run lint`, `npm test`; all green

## 5. Spec reconciliation and docs

- [ ] 5.1 Archive/sync order: `fix-feed-deletion-sync` MUST be synced/archived before this change (this delta's full-block "Push protocol with PATCH semantics" supersedes it; the reverse order reverts the `row_at` semantics in main specs)
- [x] 5.2 Grep README for sync/time language; update if stale
- [x] 5.3 Confirm the residual limitations (RTT-level ambiguity, forward clock jumps, same-ms interleave) are documented in design.md Risks
