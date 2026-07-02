## Context

The app stores all feed items in a single IndexedDB `items` store with a compound index `by-feed-published` on `[feedUrl, publishedAt]`. The "All Feeds" view uses `listItems(500)` which walks this index in reverse — because the index is grouped by `feedUrl` first, items are returned grouped by feed rather than truly interleaved chronologically. The per-feed view filters the same 500-item global pool in memory by `feedUrl`, so a feed with many items can crowd other feeds out of the result set entirely.

The eviction policy (`runEviction()` in `src/articles/eviction.ts`) strips old `extractedHtml` data but is never called from any lifecycle hook.

## Goals / Non-Goals

**Goals:**
- Per-feed views query items by feed URL directly, not from a global pool
- "All Feeds" view returns items in true chronological order interleaved across feeds
- Eviction runs automatically after each feed refresh sweep
- All changes are backward-compatible with existing IndexedDB data

**Non-Goals:**
- Changing the eviction policy itself (retention windows, thresholds)
- Adding pagination or infinite scroll
- Altering the UI components or feed parsing/subscription flow
- Data migration beyond IndexedDB index creation

## Decisions

### D1: New `by-published` index for global chronological queries

Adding a single-field index on `publishedAt` to the `items` store. `listItems()` walks this index in `prev` direction, giving the 500 most-recent items across all feeds without post-sort.

**Alternatives considered:**
- **Post-fetch sort**: Sorting 500 items in JS after fetching from `by-feed-published` would be cheap but doesn't fix the deeper problem — the cursor groups by feed, so items from feed C that are newer than items from feed A can be missed entirely due to the 500-item cursor cutoff.
- **No index change, increase limit**: Increasing the 500-item limit to, say, 5000 would reduce but not eliminate the problem, and wastes memory.
- **New object store**: Creating a separate chronological index store would duplicate data. IndexedDB indexes already handle this efficiently.

### D2: `reloadItems()` reads `state.riverScope` to pick the query

When `riverScope != null`, call `listItemsByFeed(feedUrl, 500)`. When `null` (All Feeds), call `listItems(500)`.

**Why not pass feedUrl as a parameter?** Reading from `state` eliminates errors where callers forget to pass the parameter. The store's `setState` is synchronous, so `state.riverScope` is always current by the time the async `reloadItems` executes.

### D3: Eviction is non-blocking

`runEviction()` is called with `void` after the refresh sweep so it doesn't delay the next tick. The eviction is idempotent and safe to overlap with concurrent reads/writes (it only modifies `extractedHtml` fields, never deletes items).

## Risks / Trade-offs

- **DB version bump**: Users with existing v1 databases will silently migrate to v2 on next page load. The new index is created via the `versionchange` transaction. Rollback would require unregistering the service worker and clearing IndexedDB.
- **`by-published` index storage**: Each index adds write overhead and storage cost. For the expected item volumes (<50k items), this is negligible.
- **Race on subscribe**: After subscribing, `ctx.reloadItems()` fires without changing `riverScope`. If the user was on "All Feeds", the new feed's items appear; if scoped to a different feed, that feed's items reload. This matches existing behavior and is not regressed.
