## 1. Idle Detection Module

- [x] 1.1 Create `src/util/idle.ts` with `isIdle()`, `onActivity()`, and `wasEverActive` tracking
- [x] 1.2 Add DOM event listeners (mousemove, mousedown, keydown, scroll capture, touchstart, click, wheel, pointerdown) with `passive: true`
- [x] 1.3 Implement idle→active catch-up: fire `pullIfStale + reloadItems` on first interaction after idle

## 2. Scheduler Callback

- [x] 2.1 Add `setOnRefresh(cb)` export to `src/feeds/scheduler.ts`
- [x] 2.2 Fire `onRefresh` after `refreshStaleFeeds()` processes stale feeds (not on empty ticks, not on `forceAll`)
- [x] 2.3 Gate callback behind `isIdle()` — skip if user is away

## 3. Sync Callback

- [x] 3.1 Add `setOnSync(cb)` export to `src/sync/merge.ts`
- [x] 3.2 Fire `onSync` after `applyRemoteState()` succeeds in `runPull()` (not on early return for empty payloads)
- [x] 3.3 Fire `onSync` after `mergeForFirstTime()` completes
- [x] 3.4 Gate callback behind `isIdle()` — skip if user is away

## 4. State.tsx Rewrite

- [x] 4.1 Remove the 30-second `setInterval` at `state.tsx:481-485`
- [x] 4.2 Rewrite `visibilitychange` handler: store `idleAtHide`, check absence duration + idle state, gate D1 pull
- [x] 4.3 Replace `pullNow()` with `pullIfStale(120_000)` for the `online` event
- [x] 4.4 Wire `onRefresh` and `onSync` callbacks to `reloadFeeds()` + `reloadItems()`
- [x] 4.5 Add re-entrant in-flight guard to `reloadItems()`
- [x] 4.6 Suppress callbacks in `refreshAll()` with `ignoreCallbacks` flag

## 5. Verify

- [x] 5.1 Run `npm run typecheck` — zero errors
- [x] 5.2 Run `npm run lint` — zero warnings
- [x] 5.3 Run `npm test` — all tests pass
