## Context

Sift currently refreshes its UI via a 30-second `setInterval` in `state.tsx:481` that reads all feeds and up to 500 items from IndexedDB via cursor scans. A `visibilitychange` handler at `state.tsx:487` unconditionally reloads feeds/items and pulls from D1 sync on every tab return. This generates ~500K IndexedDB cursor steps/day and ~25K D1 queries/day for a single user — dominated by the D1 `SELECT * FROM flags` sync pull at ~10K calls/day.

The 30-second poll exists because:
1. The RSS scheduler writes new items to IDB without notifying the UI
2. Sync writes new flags/feeds to IDB without notifying the UI
3. No mechanism exists to bridge "data arrived in IDB" → "UI knows about it"

The fix: replace the timer with event-driven callbacks from the scheduler and sync system, and gate D1 interactions behind user activity detection.

## Goals / Non-Goals

**Goals:**
- Remove the 30-second `setInterval` IDB poll
- Replace timer with callbacks: scheduler writes new items → UI reloads; sync pull returns data → UI reloads
- Add user idle detection (5-min inactivity) to gate UI refreshes and D1 pulls
- Gate visibilitychange D1 pulls behind absence duration (≥5 min) + active-before-hide
- Throttle `online` event D1 pulls
- Provide a one-shot catch-up on first interaction after idle

**Non-Goals:**
- Cross-tab communication (user reports single-tab-per-device usage)
- Changing the 5-minute RSS scheduler tick interval
- Changing the sync push mechanism or batching
- Changes to the D1 schema or server-side query patterns
- User-visible idle indicators or settings

## Decisions

### Decision 1: Event-driven callbacks instead of polling

**Choice:** Export `setOnRefresh(cb)` from `scheduler.ts` and `setOnSync(cb)` from `merge.ts`. Wire them in `state.tsx` to call `reloadFeeds()` + `reloadItems()`.

**Rationale:** Direct replacement for the 30s poll. Zero wasted IDB reads when nothing changed. The callbacks fire only when new data actually lands in IDB.

**Alternatives considered:**
- *BroadcastChannel from scheduler to UI:* Over-engineered for same-process communication.
- *CustomEvent on document:* Works but adds a runtime dispatch/event-loop hop. Direct callback is simpler and has no overhead.
- *Dirty flag + timer:* Hybrid approach that keeps a poll but skips when nothing changed. Still runs a timer — doesn't fully eliminate wasted cycles.

### Decision 2: Idle detection via DOM interaction events

**Choice:** A `src/util/idle.ts` module tracking `lastActivity` timestamp reset on `mousemove`, `mousedown`, `keydown`, `scroll` (capture), `touchstart`, `click`, `wheel`, `pointerdown`. All passive. Exposes `isIdle()` and `onActivity()`.

**Rationale:** A 5-minute inactivity timeout based on real browser events is the most reliable way to detect "user is away." It works whether the tab is foregrounded (pinned monitor) or backgrounded (screensaver). No permissions needed, no server round-trip.

**Alternatives considered:**
- *Page Visibility API alone:* `document.hidden` is true for background tabs but false for pinned foreground tabs the user walked away from — the worst case.
- *Idle Detection API (Chromium):* Requires user permission prompt, not suitable.
- *`requestIdleCallback`:* For scheduling low-priority work, not for detecting user presence.

### Decision 3: `wasEverActive` pattern for idle→active catch-up

**Choice:** Track `wasEverActive` (set true after first user interaction). In `onActivity()`, check `wasEverActive && isIdle()` using the *old* `lastActivity` timestamp, then reset. This fires the catch-up exactly once per idle→active transition.

**Rationale:** The simple `wasIdle: boolean` flag pattern breaks after the first idle cycle because it never resets to `true`. The `wasEverActive + isIdle()` check correctly fires on every transition from idle→active, not just the first one.

### Decision 4: Store idle-at-hide for visibilitychange handler

**Choice:** When the tab hides (`visibilitychange → hidden`), store `idleAtHide = isIdle()`. On return, use this to decide whether to hit D1:
- Absent ≥5 min + was active → pull D1 + IDB reload
- Absent ≥5 min + was idle → IDB reload only, no D1 pull
- Absent <5 min → nothing

**Rationale:** Without storing idle-at-hide, the visibilitychange handler's `onActivity()` call resets the timer. Then `isIdle()` always returns `false` after the reset, making it impossible to distinguish "was reading → walked away" from "was reading → tab briefly obscured." Storing the pre-hide idle state preserves this distinction.

### Decision 5: `reloadFeeds()` in `onRefresh` callback

**Choice:** The scheduler callback fires `reloadFeeds()` + `reloadItems()`, not just `reloadItems()`. The sync callback already fires both.

**Rationale:** The scheduler writes feed metadata (lastFetched, lastError, etag, learnedIntervalMs) to IDB during `refreshFeed()`. Without a `reloadFeeds()` call, the sidebar shows stale error/status state until the next user action.

### Decision 6: Suppress callbacks during `refreshAll()`

**Choice:** `refreshAll()` already calls `pullNow()` then `refreshStaleFeeds(true)` then explicit `reloadFeeds()` + `reloadItems()`. To prevent 3-4 redundant reloads, pass a flag `ignoreCallbacks: true` to suppress `onRefresh`/`onSync` during manual refresh. The explicit reloads at the end already cover the update.

**Alternative considered:**
- *Remove explicit reloads from `refreshAll()`:* Simpler but risky — if callbacks fire before their writes complete, the UI updates with stale data. The explicit reloads at the end are a correctness guarantee.
- *Deduplicate `reloadItems()` calls:* Add an in-flight guard that coalesces redundant calls. Works regardless of caller. Added as a secondary measure.

### Decision 7: Re-entrant guard on `reloadItems()`

**Choice:** Add a simple in-flight flag: if a `reloadItems()` call is in progress, subsequent calls are skipped (the in-flight call already reads the latest IDB state when it resolves).

**Rationale:** With 4+ concurrent callers (scheduler callback, sync callback, idle→active catch-up, user actions), multiple concurrent `reloadItems()` calls can race and cause redundant UI re-renders. A simple in-flight guard prevents this at negligible cost.

## Risks / Trade-offs

- **[Risk] `onRefresh` fires while user is mid-scroll:** `reloadItems()` replaces the items signal, causing a river re-render. The user may lose scroll/focus position. **Mitigation:** The `focusedIndex` clamping and scroll-restoration logic in River.tsx already handles this case (it was designed for the 30s poll). No regression.
- **[Risk] `onSync` could create a recursion loop if misused later:** `onSync` fires after `runPull()` which calls `scheduleFlush()`. If someone adds `pullNow()` inside `onSync`, it creates infinite recursion. **Mitigation:** Document that `onSync` must only update local state, never initiate new sync operations. The `pullIfStale` throttle also provides a safety break.
- **[Trade-off] No timer-based sync pull for always-visible pinned tabs:** With no visibility change and no user interaction, a pinned tab never auto-pulls D1. Cross-device sync only converges on manual Refresh or user return. **Mitigation:** Acceptable for this change — the user's design intent is to minimize D1 interactions.
- **[Risk] scroll events with `capture: true` may pick up scrolls from non-content elements:** `capture: true` catches scroll events on all DOM elements, including modal overlays and the settings panel. This is correct — the user is interacting with the page. Inertial scroll on macOS adds ~1-2s of extra activity time after finger lift, which is negligible against a 5-min threshold.
- **[Risk] `mousemove` is a noisy event:** A cat walking on a keyboard, browser extension, or ambient mouse vibration could extend the active window. **Mitigation:** At a 5-minute threshold, this is negligible. Add a 30-second debounce on `mousemove` if noise becomes an issue in practice.
- **[Risk] `pullIfStale` throttle is per-tab, not global:** Each browser tab has its own in-memory `lastPullAt`. Multiple tabs could each pull within the same 30-second window. **Mitigation:** Acceptable — user reports single-tab-per-device usage.

## Migration Plan

1. Create `src/util/idle.ts` with the idle detection module
2. Add `setOnRefresh` / `setOnSync` hooks to `scheduler.ts` and `merge.ts`
3. Rewrite `state.tsx`: remove 30s interval, change visibilitychange handler, wire callbacks
4. Suppress callbacks in `refreshAll()` to prevent redundant reloads
5. Add re-entrant guard to `reloadItems()`
6. Throttle `online` event with `pullIfStale`
7. Run typecheck + lint + tests

Rollback: Revert the branch. The D1 schema is unchanged.

## Open Questions

None.
