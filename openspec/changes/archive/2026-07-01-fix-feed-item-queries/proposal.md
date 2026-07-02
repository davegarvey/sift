## Why

When a user adds a new feed with many items, existing feeds appear empty in the per-feed view because the item query uses a global 500-item limit and filters in-memory by feed URL. Additionally, the "All Feeds" view shows items grouped by feed rather than truly interleaved chronologically, making it hard to see the latest posts across all feeds in proper order. Storage eviction of cached article content is defined but never triggered.

## What Changes

- When viewing a specific feed, query items by that feed's URL directly instead of filtering the global 500-item pool in memory
- Add a `by-published` index on the `items` store so the global "All Feeds" query walks items in true chronological order (not grouped by feed)
- Bump IndexedDB version from 1 to 2 to accommodate the new index
- Call `runEviction()` after each feed refresh sweep so the storage eviction policy actually runs
- No changes to the eviction policy itself, the UI components, or the feed parsing / subscription flow

## Capabilities

### New Capabilities

- `feed-item-queries`: Items are queried with correct scoping — per-feed views fetch items directly for that feed, and the "All Feeds" view iterates items in true chronological order using a dedicated `by-published` index

### Modified Capabilities

None — this is a new capability being introduced.

## Impact

- `src/db/open.ts`: Add `by-published` index, DB version bump
- `src/db/types.ts`: Bump `DB_VERSION` to 2
- `src/db/items.ts`: `listItems()` uses new index; `listItemsByFeed()` unchanged
- `src/state.tsx`: `reloadItems()` scopes query by `state.riverScope` when present
- `src/feeds/scheduler.ts`: Call `runEviction()` after refresh sweep
- No UI component changes, no data migration needed (except index creation)
