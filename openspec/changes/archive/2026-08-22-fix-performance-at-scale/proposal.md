## Why

As the user accumulates feeds and items over weeks and months, several O(n) query patterns and missing debounce/short-circuit mechanisms will cause perceptible slowdowns. IndexedDB queries don't block the main thread, but full-table substring scans on every keystroke, full-scan boolean filtering, and wasteful re-renders compound into a degraded experience. Additionally, the article extraction pipeline produces `data:` URIs for every image, bloating `extractedHtml` to MBs per article and requiring a complex multi-tier eviction system that still fails to process items beyond the 500 newest per feed.

## What Changes

- **Remove image inlining**: Store `extractedHtml` with proxy URLs (`/img?url=...`) instead of `data:` URIs. Remove the image-inlining subsystem (`inlineImages`, `stripImages`, `reinlineImages`, `injectHeroImage`). `extractedHtml` becomes text + URL references (~5-20 KB/article).
- **Simplify eviction to LRU under pressure**: Replace the multi-tier retention-based eviction with a single quota-aware LRU sweep that drops `extractedHtml` from oldest-accessed items when total IndexedDB usage exceeds a soft cap derived from `navigator.storage.estimate()`.
- **Search debounce**: Add 200ms debounce + AbortController + generation counter to the CommandPalette search to avoid firing a full DB scan on every keystroke and prevent stale overwrites.
- **Unread/starred index**: Introduce a secondary `itemFlags` object store indexed on `read` and `starred` (stored as 0/1 numbers) so `listUnreadAcrossFeeds` and `listStarred` use indexed lookups instead of full scans.
- **Hash-map feed lookups**: Replace `Array.find()` on every river item with a `Map<string, Feed>` memo.
- **Stop polling when hidden**: Skip background polling when the tab is hidden; refresh immediately on tab return via `visibilitychange`.
- **Server cache header**: Bump `/img` proxy `Cache-Control` from 24h to 30 days (`max-age=2592000, immutable`).

## Capabilities

### New Capabilities
- `search-performance`: Debounced search, AbortController cancellation, generation counter, feed map memo, visibility-aware polling
- `storage-eviction`: Quota-aware LRU pressure eviction; no image inlining
- `query-indexing`: Secondary indexes for boolean-filtered queries (unread, starred)

### Modified Capabilities
*(None)*

## Impact

- **`src/articles/extract.ts`**: Remove `inlineImages`, `stripImages`, `reinlineImages`, `injectHeroImage`. Simplify `extractArticle()` to return Readability output with original image URLs (rewritten to `/img?url=` proxy).
- **`src/articles/eviction.ts`**: Rewrite from multi-tier per-feed retention to single global LRU pressure sweep using `navigator.storage.estimate()`.
- **`src/articles/service.ts`**: No structural changes — the three-tier fallback (feed HTML → cached extractedHtml → extractArticle) remains identical.
- **`src/db/open.ts`**: New `itemFlags` object store for boolean-indexed read/starred; v3 schema migration with chunked backfill.
- **`src/db/items.ts`**: `listUnreadAcrossFeeds`, `listStarred` — query via `itemFlags`; `deleteItemsByFeed` — clean flags store; `updateItem` — central flag mutation.
- **`src/db/types.ts`**: Remove `FULL_RETENTION_MS`, `TEXTONLY_RETENTION_MS`, `FEED_STORAGE_THRESHOLD_BYTES`. Add `STORAGE_SOFT_CAP_RATIO`, `EVICTION_CHUNK_SIZE`.
- **`src/components/CommandPalette.tsx`**: Debounce wrapper, AbortController, generation counter.
- **`src/components/River.tsx`**: Replace `feeds().find(...)` with `feedMap().get(...)`.
- **`src/state.tsx`**: Add `feedMap` memo, visibility guards on 30s interval and 5min tick, `visibilitychange` listener.
- **`server/handle.ts`**: Bump `/img` cache header to `max-age=2592000, immutable`.
