## Why

The 30-second polling interval continuously re-reads all items from IndexedDB via cursor scans and triggers unconditional sync pulls on every tab visibility change. This generates ~500K IDB cursor steps/day and ~25K D1 queries/day for a single user — the vast majority wasted when nothing changed. The app should refresh the UI only when new data actually arrives (event-driven) rather than on a timer, and should gate D1 sync pulls behind user activity + absence duration to avoid unnecessary server load.

## What Changes

- **Remove** the 30-second `setInterval` that calls `reloadFeeds()` + `reloadItems()`
- **Add** user idle detection (5-minute inactivity timeout based on DOM events)
- **Add** a scheduler callback so new RSS items trigger a UI reload immediately when active
- **Add** a sync callback so data from D1 sync pulls triggers a UI reload immediately when active
- **Gate** visibilitychange handler: only refresh + pull D1 if tab was absent ≥5 minutes **and** user was active before hiding
- **Replace** unconditional `pullNow()` on `online` event with `pullIfStale(120_000)` to throttle network flapping
- **Fire** a one-shot catch-up on the first interaction after idle (pull + reload)
- **Remove** redundant `reloadFeeds()` / `reloadItems()` from `refreshAll()` (callbacks already handle it)

## Capabilities

### New Capabilities
- `user-idle-detection`: Detect when the user is actively using the app vs. away from keyboard, based on DOM interaction events with a configurable timeout
- `event-driven-refresh`: Replace timer-based UI refreshes with callbacks fired from the RSS scheduler and D1 sync system
- `smart-visibility-refresh`: Only refresh on tab return when the user was away long enough and was active before leaving

### Modified Capabilities
*(none — no spec-level behavioral requirements are changing, only implementation strategy)*

## Impact

- `src/state.tsx` — remove 30s interval, rewrite visibilitychange handler, wire callbacks
- `src/feeds/scheduler.ts` — add `onRefresh` callback, fire after stale feeds processed
- `src/sync/merge.ts` — add `onSync` callback, fire after `applyRemoteState()`
- **New**: `src/util/idle.ts` — idle detection module
- D1 query volume expected to drop from ~25K/day to ~100/day for typical use
- IDB cursor scans expected to drop from ~500K/day to near zero (only on actual data arrival)
