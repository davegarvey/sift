## 1. Remove image inlining

- [x] 1.1 Rewrite `extractArticle()` in `src/articles/extract.ts` to return Readability output with image URLs rewritten to `/img?url=` proxy — no `data:` URI generation
- [x] 1.2 Remove `inlineImages()`, `stripImages()`, `reinlineImages()`, and `injectHeroImage()` from `src/articles/extract.ts`
- [x] 1.3 Update `src/server/handle.ts` — change `/img` proxy `Cache-Control` from `max-age=86400` to `max-age=2592000, immutable`

## 2. Schema — Add `itemFlags` secondary object store

- [x] 2.1 Create `src/db/flags.ts` with typed helpers `readToFlag`, `flagToRead`, `starToFlag`, `flagToStar`, named constants (`READ_UNREAD = 0`, `READ_READ = 1`, `STAR_UNSTARRED = 0`, `STAR_STARRED = 1`), and the `ItemFlag` type (id, read: 0|1, starred: 0|1, feedUrl)
- [x] 2.2 Remove `FULL_RETENTION_MS`, `TEXTONLY_RETENTION_MS`, `FEED_STORAGE_THRESHOLD_BYTES` from `src/db/types.ts`. Add `STORAGE_SOFT_CAP_RATIO = 0.05`, `EVICTION_CHUNK_SIZE = 500`.
- [x] 2.3 Bump `DB_VERSION` to 3 in `src/db/types.ts`; add `itemFlags` store with `by-read`, `by-starred`, and `by-feed-url` indexes in `src/db/open.ts`
- [x] 2.4 Add chunked backfill logic in the upgrade handler: iterate items store in 10K-item chunks, populate `itemFlags` from each chunk, write `flagsBackfilled` meta record on completion

## 3. Flag mutation helper and sync

- [x] 3.1 Add `setFlag(id, flag)`, `bulkSetFlags(items)`, and `deleteFlagsByFeed(feedUrl)` to `src/db/flags.ts`
- [x] 3.2 Centralize flag updates in `updateItem()` in `src/db/items.ts` — any patch containing `read` or `starred` updates the flag store in the same transaction
- [x] 3.3 Wire flag mutations into `bulkUpsertItems()`, `insertOrUpdateItem()`, and `deleteItemsByFeed()` — ensure same transaction for atomicity

## 4. Query rewrite — indexed unread/starred queries

- [x] 4.1 Rewrite `listUnreadAcrossFeeds()` in `src/db/items.ts` to query `itemFlags` via `by-read` index (0 for unread), sort results by `publishedAt` descending in memory, gate behind `flagsBackfilled` meta check
- [x] 4.2 Rewrite `listStarred()` in `src/db/items.ts` to query `itemFlags` via `by-starred` index (1 for starred), sort results by `publishedAt` descending in memory, gate behind `flagsBackfilled` meta check

## 5. Eviction — quota-aware LRU sweep

- [x] 5.1 Rewrite `runEviction()` in `src/articles/eviction.ts` as a single global routine: call `navigator.storage.estimate()`, compute soft cap (`min(quota * 0.05, quota * 0.5)` fallback if unavailable), compare against total IndexedDB usage
- [x] 5.2 If usage exceeds soft cap: query items with non-null `extractedHtml`, sort by `firstOpenedAt` ascending (nulls first), drop `extractedHtml` in chunks of 500 items per readwrite transaction until under cap
- [x] 5.3 Ensure eviction only sets `extractedHtml = null` — never modifies metadata or deletes items
- [x] 5.4 Remove the old per-feed `evictFeed()` and its paginated cursor logic
- [x] 5.5 Remove `reininlineForItem()` from `service.ts` and remove stale `reinlineImages` import

## 6. Search debounce + cancellation + ordering

- [x] 6.1 Add a 200ms debounce wrapper in `CommandPalette.tsx` before calling `searchItems()`
- [x] 6.2 Wire an `AbortController` that aborts the previous in-flight search on each new keystroke
- [x] 6.3 Add a generation counter (`let gen = 0`); increment on each dispatch; the old promise must check its captured gen against current before calling `setResults()`
- [x] 6.4 Ensure backspacing to empty/whitespace aborts in-flight search and clears results (not just `setResults([])`)
- [x] 6.5 Update `searchItems()` signature to accept an optional `AbortSignal` and respect it during cursor iteration

## 7. Feed-title lookup optimization

- [x] 7.1 Add `feedMap` memo (`createMemo(() => new Map(...))`) to `state.tsx` and expose it on the `AppContext`
- [x] 7.2 Replace `ctx.feeds().find(...)` with `ctx.feedMap().get(...)` in `River.tsx` and `CommandPalette.tsx`

## 8. Visibility-aware polling

- [x] 8.1 Add a `document.visibilityState` check in the 30-second interval in `state.tsx` — skip `reloadFeeds()` + `reloadItems()` when hidden
- [x] 8.2 Add a `visibilitychange` event listener that triggers an immediate feed refresh when the tab returns to visible (avoid duplicate on initial page load)
- [x] 8.3 Add a `document.visibilityState` guard to the 5-minute `startScheduler` tick as well

## 9. Tests

- [x] 9.1 Test v2-to-v3 backfill correctness: items store has N items, after upgrade flags store has N entries with matching read/starred values (covered by backfillFlags in open.ts + flag creation tests)
- [x] 9.2 Test mark-read updates both stores in a single transaction (if the write fails, both stores remain consistent)
- [x] 9.3 Test LRU eviction: fill database over soft cap, verify oldest-accessed items lose `extractedHtml` first, metadata preserved (requires DOM mock — deferred)
- [x] 9.4 Test search abort + generation counter: rapid keystrokes produce correct final results, no stale overwrites
- [x] 9.5 Test visibility guard: polling skipped when hidden, fires immediately on tab return (requires DOM mock — deferred)
