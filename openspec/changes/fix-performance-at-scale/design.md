## Context

The Sift RSS reader stores items in IndexedDB and serves them to a SolidJS single-page app. After extended use, three patterns cause performance degradation:

1. **Full-table scans for boolean-filtered queries**: `listUnreadAcrossFeeds` and `listStarred` walk the entire `by-feed-published` index and filter in JS because IDB doesn't accept booleans as index keys. With 50K+ items, this scans all of them.

2. **Image inlining bloats storage**: `extractArticle()` converts all images to `data:` URIs, making `extractedHtml` ~1-5 MB per article. This forces a complex multi-tier eviction system (7-day full, 30-day text-only, pressure-based) that still fails to process items beyond the 500 newest per feed, allowing unbounded storage growth.

3. **No debounce on search**: `CommandPalette` fires `searchItems()` on every keystroke without debounce or cancellation, triggering a full substring scan of all items.

Additional minor issues: O(n*m) feed title lookups in the river, and wasteful 30-second polling when the tab is hidden.

## Goals / Non-Goals

**Goals:**
- Replace full-scan boolean filtering with indexed lookups for unread and starred queries
- Eliminate `data:` URI inlining so `extractedHtml` is text + URL references (~5-20 KB/article)
- Replace multi-tier retention eviction with a single quota-aware LRU sweep under pressure
- Debounce search with correct abort ordering (generation counter)
- Switch feed title resolution from O(n) `find()` to O(1) `Map.get()`
- Skip background polling when hidden; refresh immediately on tab return
- Extend `/img` proxy cache to 30 days so the browser serves images on re-read

**Non-Goals:**
- Full-text search engine for IndexedDB (beyond substring matching)
- Virtual scrolling or DOM windowing in the river (not needed at 500 items)
- Changes to the read/unread/starred data model on the Item type
- User-visible storage UI (eviction is always silent)

## Decisions

### Decision 1: Use proxy URLs instead of `data:` URIs for images

**Choice**: `extractArticle()` produces HTML with `<img src="/img?url=<encoded-upstream-url>">` — no `data:` URI inlining. The functions `inlineImages`, `stripImages`, `reinlineImages`, and `injectHeroImage` are removed.

**Rationale**: Inlining images as `data:` URIs bloats `extractedHtml` to MBs, necessitating the complex eviction system. Using proxy URLs keeps `extractedHtml` small (~5-20 KB), lets the browser's HTTP cache handle image re-fetching via the `/img` proxy (which sets `Cache-Control: public, max-age=2592000, immutable`), and eliminates the entire image-strip/eviction complexity. The trade-off is that images load on network availability rather than being embedded, but this matches standard web page behavior and the vast majority of users have internet access. The `/img` proxy already exists and is unchanged — only the consumption side changes.

**Alternatives considered**:
- *Keep data: URIs with better eviction*: Fixing the eviction boundary (beyond 500) still leaves MBs per article. The complexity of the eviction system is a symptom of inlining, not a standalone problem.
- *Store both: proxy URL version for display, data: URI for offline*: Doubles storage with marginal benefit for an app that doesn't advertise offline reading.

### Decision 2: Quota-aware LRU pressure eviction

**Choice**: Single eviction routine: on each scheduler tick, call `navigator.storage.estimate()`, compare `usage` against `softCap`, and if exceeded, sort items by `firstOpenedAt` ascending and drop `extractedHtml` in chunks of 500 until under the cap. The soft cap is `min(quota * 0.05, quota * 0.5)` with a fixed fallback of 500 MB.

**Rationale**: Without `data:` URI inlining, `extractedHtml` is small. There's no need for age-based retention tiers — we can store it permanently and only evict under pressure. LRU (sort by `firstOpenedAt`) drops items the user hasn't touched, which is the right semantic. The browser's `navigator.storage.estimate()` provides per-user quota context, so the cap adapts to the device.

**Alternatives considered**:
- *Fixed threshold (e.g., 500 MB for everyone)*: Doesn't adapt to low-storage devices or generous quotas on desktops.
- *Tiered retention (keep 30+ days, drop on pressure)*: Unnecessary complexity when `extractedHtml` is small.
- *No eviction at all*: Safe for typical use (text-only is ~50-200 MB for years), but a safety net prevents surprises on low-storage devices and private browsing modes where IndexedDB quotas can be as low as 100 MB.

### Decision 3: Chunked batched transactions for eviction writes

**Choice**: Eviction processes items in chunks of 500, each chunk in a single `readwrite` transaction. If a transaction times out (unlikely for 500 items), it's retried on the next scheduler tick.

**Rationale**: Individual transactions per item are wasteful (O(n) round-trips). One massive transaction risks blocking concurrent writes (markRead, toggleStar) for too long. Chunking at 500 balances efficiency with responsiveness.

### Decision 4: Add a `flags` secondary object store for boolean-indexed queries

**Choice**: Introduce a new `itemFlags` object store keyed by item ID with numeric `read` (0/1) and `starred` (0/1) fields, each with its own index (`by-read`, `by-starred`). Also include a `feedUrl` field with a `by-feed-url` index for efficient bulk deletion.

**Rationale**: IDB cannot index boolean fields directly — `true`/`false` are not valid index key types. Using a number (0/1) in a dedicated store is the standard workaround. Adding `feedUrl` as an indexed field makes `deleteItemsByFeed` efficient via a single index range scan of the flags store rather than requiring a join.

**Alternatives considered**:
- *Denormalize read/starred as numbers on the Item*: Requires migrating all existing items; the `Item` type is also the primary record and mixing index keys with data adds cognitive load.
- *In-memory cache of unread/starred IDs*: Would need to be rebuilt on every page load and doesn't scale with storage eviction.

### Decision 5: AbortController + generation counter for search cancellation

**Choice**: Each keystroke in the CommandPalette creates a new `AbortController`. The previous search's `AbortController` is aborted before starting a new one. A generation counter is incremented on each dispatch; the promise's completion handler checks its captured generation against the current value before calling `setResults()`. The debounce window is 200ms.

**Rationale**: `AbortController` alone is insufficient — an aborted IDB cursor may still complete (IDB doesn't abort mid-iteration). The generation counter guarantees correctness: even if the old promise resolves after the new one, its results are discarded. This prevents the classic race where an aborted-but-resolved stale search overwrites fresh results.

### Decision 6: `feedMap` as a derived memo

**Choice**: In `state.tsx`, add a `feedMap` computed via `createMemo(() => new Map(feeds().map(f => [f.url, f])))` and expose it on the context. Components use `feedMap().get(url)` instead of `feeds().find(...)`.

**Rationale**: SolidJS `createMemo` is reactive and only recomputes when `feeds()` changes. The `Map` lookup is O(1). Minimal code change, no new dependencies.

### Decision 7: Backfill completion gate for `itemFlags`

**Choice**: The v2-to-v3 migration populates the `itemFlags` store in chunks (10K items per transaction) and writes a `meta` record with key `flagsBackfilled` set to `true` when done. Until that record exists, `listUnreadAcrossFeeds` and `listStarred` fall back to the original full-scan implementation.

**Rationale**: Without the gate, users with 50K+ existing items would see incomplete unread/starred results during the (potentially multi-second) backfill. The fallback ensures correctness at the cost of temporarily degraded performance — acceptable for a one-time migration.

## Risks / Trade-offs

- **[Risk] `/img` proxy downtime breaks article images**: The proxy is stateless and co-hosted with the app. If it goes down, images fail to load. **Mitigation**: The proxy is a simple fetch passthrough with cache headers. If it fails, images show a broken state — recoverable on retry. Text content is always available.
- **[Risk] Browser HTTP cache eviction drops images for old articles**: The browser's disk cache is LRU and can drop images under pressure. **Mitigation**: The `max-age=2592000` (30 day) cache gives good longevity. On re-read, if an image is evicted from cache, it loads from the proxy — same cost as the initial read. The `immutable` directive prevents re-validation.
- **[Risk] Secondary store gets out of sync with primary items**: If a code path updates `read` or `starred` on the `items` store without updating `itemFlags`, queries return stale results. **Mitigation**: Centralize flag mutations in `updateItem()` itself — any patch containing `read` or `starred` updates the flag store in the same transaction. This creates one chokepoint that's hard to drift from.
- **[Risk] Numeric 0/1 for read/starred is error-prone**: It's easy to confuse boolean `true` with numeric `1`. **Mitigation**: Wrap the conversion in typed helpers `readToFlag(b: boolean): 0 | 1` and `flagToRead(n: number): boolean` to make the boundary explicit. Named constants `READ_UNREAD = 0`, `READ_READ = 1`, `STAR_UNSTARRED = 0`, `STAR_STARRED = 1` in types.ts.
- **[Trade-off] Search performance still degrades with item count**: `searchItems()` still scans all items via substring match. The debounce, AbortController, and generation counter mitigate the UI impact, but the scan cost itself remains O(n). A trigram index or full-text search could eliminate scans entirely but is out of scope.
- **[Trade-off] Debounce adds 200ms latency to search results**: Standard UX for search-as-you-type and preferable to jank.

## Migration Plan

1. **Remove image inlining**: Rewrite `extractArticle()` to return Readability output with proxy URLs. Remove `inlineImages`, `stripImages`, `reinlineImages`, `injectHeroImage`. Existing `extractedHtml` entries with `data:` URIs in IndexedDB will continue to render fine (they're just HTML) and will be gradually evicted under LRU pressure.
2. **Schema upgrade**: Add the `itemFlags` object store (v3). Chunked backfill from existing items. Write `flagsBackfilled` meta record.
3. **Flag mutation helper**: Create `src/db/flags.ts` with typed helpers. Wire centrally into `updateItem()`, `bulkUpsertItems()`, `insertOrUpdateItem()`, `deleteItemsByFeed()`.
4. **Query rewrite**: Replace `listUnreadAcrossFeeds` and `listStarred` to use `itemFlags` indexes with in-memory `publishedAt` sort. Gate behind `flagsBackfilled`.
5. **Eviction rewrite**: Replace the old `evictFeed()` with a single global routine: get storage estimate → compute soft cap → if over, sort by `firstOpenedAt` and drop `extractedHtml` in chunks of 500.
6. **Search debounce + AbortController + generation counter**: Add in `CommandPalette.tsx`. Update `searchItems()` to accept `AbortSignal`.
7. **Feed map**: Add memoized map in `state.tsx`. Update `River.tsx` and `CommandPalette.tsx`.
8. **Visibility-aware polling**: Add `document.visibilityState` guard on 30s interval and 5min tick. Add `visibilitychange` listener.
9. **Server cache header**: Update `server/handle.ts` `/img` cache to `max-age=2592000, immutable`.
10. **Tests**: Backfill correctness, atomic flag mutations, LRU eviction at cap, search abort + generation counter, visibility guard.

## Open Questions

None resolved during exploration. The design covers the open items from the review: no retention tiers needed, proxy URL images, quota-aware LRU cap, chunked eviction transactions, no image stripping.
