## Context

The app has a periodic sync pull (30s interval, tab visibility, online event) but the explicit "Refresh all" CTA — accessible from the sidebar button, keyboard shortcut `r`, command palette, and the "Check for new items" link in the empty river — only refreshes local feeds from upstream proxies. Synced clients using D1-based sync never pull remote state during this explicit user action.

## Goals / Non-Goals

**Goals:**
- Add a sync pull to the beginning of `refreshAll()` so remote state (feeds added by other devices, flag changes) is fetched before local refresh runs.
- Zero impact on non-synced clients.
- No new UI or settings changes.

**Non-Goals:**
- Adding real-time push or WebSocket sync.
- Changing the periodic poll or the existing "Sync now" button in settings.
- Modifying the push side of the sync workflow.

## Decisions

- **Call `pullNow()` before `refreshStaleFeeds(true)`**: Pulling first ensures newly synced feeds are available in local IndexedDB before the upstream refresh phase fetches their items. This also follows the natural order: get remote changes, then refresh everything locally.
- **`pullNow()` wrapped in try/catch in `refreshAll()`**: `pullNow()` propagates errors up to its caller (it doesn't catch internally). The try/catch in `refreshAll()` ensures a sync failure doesn't interrupt the upstream feed refresh. Callers that want to surface errors to the user (e.g., settings "Sync now" button) can call `pullNow()` directly without the wrapper.
- **No `scheduleFlush()` after the pull**: The pull runs `scheduleFlush()` internally in `runPull()` if there are local changes to push. Adding another flush here would be redundant.

## Risks / Trade-offs

- **Sync pull adds latency to "Refresh all"**: A pull is a single `GET /sync/pull?since=X` to the D1 server. On a fast connection this is sub-100ms. Since `refreshStaleFeeds(true)` already makes N parallel upstream requests (taking seconds), the sync pull adds negligible overhead.
- **The pull happens even if sync is configured but the server is down**: `pullNow()` returns early if no sync key is set. If a key is set but the server is unreachable, `runPull()` catches the error internally — the refresh continues without remote state, which is the same behavior as today.
