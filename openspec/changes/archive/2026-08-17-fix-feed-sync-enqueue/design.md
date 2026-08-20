## Context

Sift's sync layer uses a "dirty queue" pattern. When a feed is added, updated, or removed, the change must be:

1. Written to the local IndexedDB feed store.
2. Enqueued in the in-memory dirty set (`sync/queue.ts`) so the debounced flusher can push it to the D1-backed sync server.
3. (For UI callers) Refreshed in the Solid signals so the river view reflects the change immediately.

Today, these three steps are composed inline at the call site. Two UI components (`AddFeedModal`, `ConfirmUnsubscribeModal`) and the OPML import path (`opml/merge.ts`) only do step 1, which is why the server's `feeds` table is empty and QR-paired devices see no feeds. The MCP `add-feed` / `remove-feed` handlers in `state.tsx` are the only places that compose all three steps — and they do it inline rather than via a shared function.

Two prior-art compositions exist for item-level operations: `markReadAndSync` and `toggleStarAndSync` in `state.tsx:191-217`. Both are exposed on the `AppContext` and used by every caller. The feed-level operations have no equivalent, which is the gap this change closes.

The QR auto-pairing block in the app boot IIFE has two related issues: it doesn't refresh the feeds/items signals after the first-time setup completes, and `bootSync()` is called with `void` (fire-and-forget) so on subsequent visits there is a race between the initial `reloadFeeds()` and the async sync.

## Goals / Non-Goals

**Goals:**
- Establish a single, shared composition for feed subscribe/unsubscribe so future call sites cannot forget to enqueue for sync.
- Make the composition usable from both React (Solid) and non-React code paths (OPML, future tooling, tests).
- Fix the four call sites currently in violation: `AddFeedModal`, `ConfirmUnsubscribeModal`, `opml/merge.ts`, and the MCP handlers (which use the right pattern but inline it).
- Fix the latent stale-items bug in the MCP unsubscribe path.
- Fix the QR-paired device "empty page until 30s reload" issue.
- Add a regression test for the dirty queue behavior.

**Non-Goals:**
- Changing the wire format of `/sync/push` or `/sync/pull`.
- Changing the server's D1 schema.
- Changing the public-facing `Feed` type shape in `db/types.ts`.
- Refactoring the item-level mark-read / star pattern (it already follows the desired shape).
- Removing the dead `markRead` import in `River.tsx` or the dead `deleteFlagsByFeed` function (drive-by cleanups; will be filed as a follow-up).
- Adding tests for the context-method wrappers themselves (the service test covers the core behavior; the wrappers are one-liners).

## Decisions

### 1. New module: `src/feeds/service.ts`

The composition lives in a new pure module that imports from `db/feeds` and `sync/queue` only (no Solid). This lets non-React callers use it and makes the function trivially testable.

```ts
// src/feeds/service.ts
export interface SubscribeInput {
  url: string;
  title: string;
  folder?: string[];
  htmlUrl?: string;
}

export async function subscribeFeed(input: SubscribeInput): Promise<void> {
  const now = Date.now();
  await upsertFeed({
    url: input.url,
    title: input.title,
    htmlUrl: input.htmlUrl,
    folder: input.folder,
    learnedIntervalMs: 60 * 60 * 1000,
    lastFetched: null,
    lastItemPublishedAt: null,
  });
  enqueueFeed({
    feedUrl: input.url,
    folder: input.folder ?? null,
    folderAt: now,
    title: input.title,
    titleAt: now,
    deleted: 0,
    deletedAt: now,
  });
  scheduleFlush();
}

export async function unsubscribeFeed(url: string): Promise<void> {
  await dbUnsubscribeFeed(url);
  enqueueFeedDelete(url, Date.now());
  scheduleFlush();
}
```

**Why a separate module rather than methods on `db/feeds.ts`?** `db/` is the storage layer; `sync/` is the network layer. Mixing them collapses the layering and creates a circular risk (e.g., `sync/apply.ts` already calls `upsertFeed` to apply remote state; if `upsertFeed` also enqueued, applying remote state would re-enqueue feeds that just came from the server).

**Why a separate module rather than only a context method?** `opml/merge.ts` is a non-React module called from the UI. It cannot import the Solid context provider. Putting the primitive in a pure module and wrapping it in the context gives both consumers a path.

### 2. Context wrappers in `state.tsx`

Add `subscribeFeed` and `unsubscribeFeed` to `AppContext` as thin wrappers that delegate to the service and additionally refresh the signals. This mirrors the existing `markReadAndSync` / `toggleStarAndSync` shape.

```ts
const subscribeFeedCtx = async (input: SubscribeInput) => {
  await subscribeFeed(input);
  await reloadFeeds();
  await reloadItems();
};

const unsubscribeFeedCtx = async (url: string) => {
  await unsubscribeFeed(url);
  if (state.riverScope === url) {
    setRiverScope(null);
  }
  await reloadFeeds();
  await reloadItems();
};
```

Note: `setRiverScope(null)` is used (not `setState({ riverScope: null })`) to match the existing UI behavior of also resetting `focusedIndex` and `view` — `setRiverScope` is the established setter and should be the single way to change scope.

### 3. `AddFeedModal.tsx` change

`AddFeedModal.subscribe()` currently does two writes: a `upsertFeed` to create the record, then a second `upsertFeed` to set `lastFetched` / `lastItemPublishedAt` after items are upserted. The first write is the one that should go through the new path. The second write is local-only metadata (the wire format does not carry these fields) and should stay as a direct `upsertFeed` call.

```ts
// Before
await upsertFeed({ url: d.url, title: d.title, ... });
ctx.closeModal();
void ctx.reloadFeeds();
void ctx.mcpNotifySync();
const items = parsedToItems(d.parsed, d.url);
if (items.length > 0) {
  await bulkUpsertItems(items);
  const lastPublished = Math.max(...items.map((i) => i.publishedAt));
  await upsertFeed({ url: d.url, title: d.title, ..., lastFetched: Date.now(), lastItemPublishedAt: lastPublished ?? null });
}
void ctx.reloadItems();

// After
await ctx.subscribeFeed({ url: d.url, title: d.title });
ctx.closeModal();
void ctx.mcpNotifySync();
const items = parsedToItems(d.parsed, d.url);
if (items.length > 0) {
  await bulkUpsertItems(items);
  const lastPublished = Math.max(...items.map((i) => i.publishedAt));
  await upsertFeed({ url: d.url, title: d.title, ..., lastFetched: Date.now(), lastItemPublishedAt: lastPublished ?? null });
}
void ctx.reloadItems();
```

Drop the `import { upsertFeed } from '../db/feeds';` once the second `upsertFeed` call is the only remaining usage... wait, the second call still uses it. Keep the import.

### 4. `ConfirmUnsubscribeModal.tsx` change

Replace `unsubscribeFeed(feedUrl)` + `ctx.reloadFeeds()` + `ctx.reloadItems()` with `ctx.unsubscribeFeed(feedUrl)`. Keep `mcpNotifySync()` at the modal layer (it is MCP-specific; the service doesn't know about MCP). Keep `setRiverScope` reset behavior (now in the context method).

Drop `import { unsubscribeFeed } from '../db/feeds';` since the modal no longer calls it directly.

### 5. `opml/merge.ts` change

Replace the `upsertFeed` loop with a `subscribeFeed` loop using the same `SubscribeInput` shape. The function is now async-aware of the service, but its public signature is unchanged. Callers in `SettingsDrawer.tsx` continue to work.

### 6. MCP handlers in `state.tsx`

Replace the inline `upsertFeed` / `unsubscribeFeed` / `enqueueFeed` / `enqueueFeedDelete` / `reloadFeeds` compositions in the MCP `add-feed` and `remove-feed` listeners with calls to `ctx.subscribeFeed` and `ctx.unsubscribeFeed` respectively. The `mcpNotifySync` POST-back to the server is dropped (the MCP server initiated the change; notifying it would be a no-op round trip). The `setRiverScope` reset on MCP unsubscribe is now handled by the context method.

This collapse removes ~30 lines of duplication and incidentally fixes the latent bug where the MCP unsubscribe path was missing a `reloadItems()` call.

### 7. QR pairing block: post-setup signal refresh

In the app boot IIFE, after `await triggerFirstTime()` in the `if (pairCode)` block, add `await reloadFeeds()` and `await reloadItems()`. This makes the target device show the synced feeds immediately on first visit instead of waiting for the next 30s poll.

### 8. `bootSync()` becomes awaited

In the app boot IIFE, change `void bootSync();` to `await bootSync();`. On subsequent visits this guarantees the sync completes before the initial `reloadFeeds()` runs, eliminating the race where the user could briefly see an empty state. The `reloadFeeds()` / `reloadItems()` calls that follow in the QR block remain (they handle the first-visit case; subsequent visits fall through that block).

### 9. Test placement: `tests/sync-queue.test.ts`

New test file. Imports `subscribeFeed` and `unsubscribeFeed` from `src/feeds/service.ts` and asserts that the in-memory dirty set contains the expected `feed-upsert` / `feed-delete` entries after each call. Uses `getDirty()` from `sync/queue.ts` to inspect. Uses `fake-indexeddb` (or whatever the existing test setup uses) to satisfy the IDB write side effects.

The test is fast (no network, no real IDB) and would have caught the original bug.

## Risks / Trade-offs

- **[Risk] OPML import of many feeds triggers many individual enqueues.** Each `subscribeFeed` call in the OPML loop calls `enqueueFeed` and `scheduleFlush` (debounced). The debounce coalesces them into one push. **Mitigation:** verified by reading `sync/push.ts:76-82` — the 1s debounce in `scheduleFlush` collapses N calls into one network push. No code change needed.
- **[Risk] `subscribeFeed` and `unsubscribeFeed` are now imported in many files, raising the chance of accidental misuse.** **Mitigation:** the function names are explicit about what they do; the service has only two exports; `eslint` would catch any import of `upsertFeed` from a UI file (the linter already restricts `db/` access in some places — verify, or add a comment in the service module).
- **[Risk] Awaiting `bootSync()` delays first paint.** **Mitigation:** `bootSync()` is fast on a no-op (no key) or on a `runPull` that returns an empty delta. Worst case is a network round trip to `/sync/pull` plus the IndexedDB write. This is acceptable; the alternative (showing a stale empty state then a 30s-later jump to populated) is worse UX.
- **[Risk] The context method's `setRiverScope` reset on unsubscribe is a behavior change for any caller that currently does it manually.** **Mitigation:** audit shows `ConfirmUnsubscribeModal.tsx` and the MCP `remove-feed` handler are the only unsubscribe call sites; both currently do their own scope reset. Centralizing in the context method means the modals no longer need to call `setRiverScope(null)` themselves.
- **[Risk] Adding a new module increases the file count.** **Mitigation:** the new module is 30 lines and replaces ~40 lines of inline composition across three files. Net code is smaller, not larger.

## Migration Plan

No data migration. The dirty queue is in-memory; the local IDB feed store is unchanged. After deploying, all existing users will:
- On their next feed add/remove via UI: the change is now enqueued and will be pushed on the next debounced flush.
- On their next reload: `bootSync()` runs and pulls any state from the server (server will be empty for users who have not yet added a feed through the refactored path).
- Users who already have feeds and want them on the server: no auto-migration. They can disable and re-enable sync to trigger a fresh first-time setup, which will push all current feeds. (This is a one-time inconvenience; documenting this in the PR description is enough.)

**Rollback:** revert the commit. No schema or wire-format changes, so rollback is safe.

## Open Questions

None. The red-team analysis resolved all ambiguities. The signature of `SubscribeInput` is final; the test file path follows the existing `tests/` convention; the `setRiverScope` reset behavior in the context method matches the existing UI pattern.
