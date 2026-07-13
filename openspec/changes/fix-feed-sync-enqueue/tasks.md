## 1. Service module

- [x] 1.1 Create `src/feeds/service.ts` with `SubscribeInput` type, `subscribeFeed(input)`, and `unsubscribeFeed(url)` functions
- [x] 1.2 Add `scheduleFlush` call inside `subscribeFeed` and `unsubscribeFeed`

## 2. Context wrappers

- [x] 2.1 Add `subscribeFeed` and `unsubscribeFeed` to `AppContext` in `src/state.tsx` that delegate to the service and refresh signals
- [x] 2.2 Add `subscribeFeed` and `unsubscribeFeed` to the `AppContext` interface in `src/state.tsx`
- [x] 2.3 Add the new methods to the `value` object in `src/state.tsx`

## 3. UI refactors

- [x] 3.1 Refactor `AddFeedModal.subscribe()` to call `ctx.subscribeFeed` for the initial write; keep the second `upsertFeed` (local metadata) as-is
- [x] 3.2 Refactor `ConfirmUnsubscribeModal.handleConfirm()` to call `ctx.unsubscribeFeed`; drop the `unsubscribeFeed` import from `db/feeds`
- [x] 3.3 Refactor `opml/merge.ts applyMerge()` to call `subscribeFeed` in a loop instead of `upsertFeed` directly

## 4. MCP handler refactors

- [x] 4.1 Replace the inline `add-feed` composition in `src/state.tsx` with `ctx.subscribeFeed(data.feed)`
- [x] 4.2 Replace the inline `remove-feed` composition in `src/state.tsx` with `ctx.unsubscribeFeed(data.url)`

## 5. Boot sequence fixes

- [x] 5.1 In the app boot IIFE, after `await triggerFirstTime()` in the QR pairing block, add `await reloadFeeds()` and `await reloadItems()`
- [x] 5.2 Change `void bootSync();` to `await bootSync();` in the app boot IIFE

## 6. Test

- [x] 6.1 Create `tests/sync-queue.test.ts` with two tests: `subscribeFeed` enqueues `feed-upsert`; `unsubscribeFeed` enqueues `feed-delete`
- [x] 6.2 Run `npm test` and confirm new tests pass

## 7. Verification

- [x] 7.1 Run `npm run typecheck` — zero errors
- [x] 7.2 Run `npm run lint` — zero warnings
- [x] 7.3 Run `npm test` — all tests pass
- [x] 7.4 Run `npm run build` — succeeds
- [ ] 7.5 Manual smoke test: add a feed, observe a `feed-upsert` row appears in D1 `feeds` table (per `row_at` timestamp)
- [ ] 7.6 Manual smoke test: scan QR code on a second device, observe feeds appear immediately without waiting for 30s reload
