## Why

Feeds added, modified, or removed via the normal UI (`AddFeedModal`, `ConfirmUnsubscribeModal`) and via OPML import (`opml/merge.ts`) are written to local IndexedDB but never enqueued for sync. The `enqueueFeed` and `enqueueFeedDelete` calls are only made from the MCP/EventSource path in `state.tsx`. As a result, the server's `feeds` table in D1 stays empty, and devices that pair via QR code see no feeds after pairing. The root cause is architectural: feed mutation is split across three layers (DB, sync queue, UI signals) with no single function composing them, so each call site has to remember all three steps — and most forgot.

## What Changes

- Introduce a `feed-service` capability: pure functions `subscribeFeed` and `unsubscribeFeed` in `src/feeds/service.ts` that compose the DB write, the sync enqueue, and the flush schedule. Non-React callers (OPML import, future tooling, tests) use these directly.
- Expose `ctx.subscribeFeed` and `ctx.unsubscribeFeed` on the `AppContext` in `src/state.tsx` as thin wrappers around the service functions that additionally refresh the `feeds` / `items` signals and reset `riverScope` on unsubscribe. This mirrors the existing `markReadAndSync` / `toggleStarAndSync` pattern.
- Refactor `AddFeedModal`, `ConfirmUnsubscribeModal`, and `opml/merge.ts` to use the new service / context methods instead of calling `upsertFeed` / `unsubscribeFeed` directly.
- Refactor the MCP `add-feed` and `remove-feed` handlers in `state.tsx` to use the new context methods, so all four call sites share one code path. This incidentally fixes a latent bug where the MCP unsubscribe path was missing a `reloadItems()` call.
- Add a test that asserts `subscribeFeed` enqueues a `feed-upsert` entry and `unsubscribeFeed` enqueues a `feed-delete` entry, so future regressions are caught.
- Add a `await reloadFeeds()` / `await reloadItems()` after `triggerFirstTime()` in the QR auto-pairing block so the target device renders the synced feeds immediately on first visit.
- Make the `bootSync()` call on app boot `await`ed (not `void`) so the sync completes before the initial `reloadFeeds()` on subsequent visits.

## Capabilities

### New Capabilities
- `feed-service`: A shared service layer for feed subscribe/unsubscribe that atomically performs the local DB write, the sync queue enqueue, and the flush schedule. Exposes both a service function (for non-React callers) and context methods (for UI components).
- `sync-queue-test-coverage`: A regression test that asserts the dirty queue is populated when feeds are subscribed or unsubscribed via the service.

### Modified Capabilities

## Impact

**New code:**
- `src/feeds/service.ts` — `subscribeFeed(input)` and `unsubscribeFeed(url)`, plus `SubscribeInput` type.
- `src/state.tsx` — add `subscribeFeed` and `unsubscribeFeed` to `AppContext`; refactor MCP handlers; await `bootSync()`; add post-pairing reload.
- `tests/sync-queue.test.ts` — new test file.

**Modified code:**
- `src/components/AddFeedModal.tsx` — replace direct `upsertFeed` call with `ctx.subscribeFeed(...)`.
- `src/components/ConfirmUnsubscribeModal.tsx` — replace direct `unsubscribeFeed` call with `ctx.unsubscribeFeed(...)`.
- `src/opml/merge.ts` — replace direct `upsertFeed` loop with `subscribeFeed` calls.

**Removed:**
- The inline composition in `state.tsx` MCP handlers (replaced by context method calls).
- The duplicate DB + enqueue logic that currently lives in MCP handlers.

**Behavior changes:**
- OPML-imported feeds will now sync to the server (previously did not).
- MCP-unsubscribed devices will refresh their items view immediately (previously stale until next 30s poll).
- QR-paired devices will show synced feeds immediately on first visit (previously showed empty state until next 30s reload).
- Subsequent reloads of any device with sync enabled will complete initial sync before the first render of feeds/items (previously had a race where `reloadFeeds` ran before `bootSync` populated IndexedDB).

**No external API changes.** No wire format changes. No DB schema changes.
