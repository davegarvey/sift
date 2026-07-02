# Fix: True chronological interleaving + per-feed queries + eviction wiring

## Problem

1. **Per-feed views appear empty**: `reloadItems()` calls `listItems(500)` globally. The `River` component filters these 500 items in-memory by `feedUrl`. A new feed with many items fills the pool, making existing feeds appear empty.

2. **"All Feeds" not interleaved**: The `by-feed-published` index is `[feedUrl, publishedAt]`. Iterating it in `prev` groups by feed — you see all items from one feed in order, then another. A post-fetch sort doesn't fix the deeper issue: the cursor stops at 500 items while still inside feed B, missing feed C's newer items entirely.

3. **Eviction never runs**: `runEviction()` is defined but never called.

## Changes

### 1. `src/db/types.ts` — Bump `DB_VERSION` to 2

```
Line 5: export const DB_VERSION = 2;
```

### 2. `src/db/open.ts` — Add `by-published` index + update schema type

**Interface change** — add `by-published` to the `items` indexes:

```ts
// Line 12-16
indexes: {
  'by-feed-published': [string, number];
  'by-guid': string;
  'by-published': number;
};
```

**Upgrade handler** — add `oldVersion` and `transaction` params, create the new index on existing stores:

```ts
// Line 28 — add params
upgrade(db, oldVersion, newVersion, transaction) {
  // ... existing store creation blocks unchanged ...

  // v2: add by-published index for global chronological queries
  if (oldVersion < 2) {
    const store = transaction.objectStore('items');
    if (!store.indexNames.contains('by-published')) {
      store.createIndex('by-published', 'publishedAt');
    }
  }
}
```

### 3. `src/db/items.ts` — Use `by-published` index in `listItems()`

Change `listItems()` (line 82-94) to iterate the `by-published` index instead of `by-feed-published`:

```ts
export async function listItems(limit = 500): Promise<Item[]> {
  const db = await getDb();
  const results: Item[] = [];
  let cursor = await db
    .transaction('items', 'readonly')
    .store.index('by-published')
    .openCursor(null, 'prev');
  while (cursor && results.length < limit) {
    results.push(cursor.value);
    cursor = await cursor.continue();
  }
  return results;
}
```

This gives true global chronological ordering — the 500 most-recent items across all feeds.

### 4. `src/state.tsx` — Per-feed query in `reloadItems`

**Import `listItemsByFeed`** (line 5):

```ts
import { listItems, listItemsByFeed, markRead } from './db/items';
```

**Change `reloadItems`** (lines 85-86):

```ts
const reloadItems = async () => {
  if (state.riverScope != null) {
    setItems(await listItemsByFeed(state.riverScope, 500));
  } else {
    setItems(await listItems(500));
  }
};
```

No call-site changes needed — `reloadItems` reads `state.riverScope` from the store directly, which `createStore` updates synchronously before the async query executes.

### 5. `src/feeds/scheduler.ts` — Wire up eviction

**Import `runEviction`**:

```ts
import { runEviction } from '../articles/eviction';
```

**Call after refresh sweep** in `refreshStaleFeeds` (after the `mapConcurrent` call):

```ts
await mapConcurrent(stale, (f) => refreshFeed(f), 4);
void runEviction();
```

## Verification

1. `npm run typecheck` — zero errors
2. `npm run lint` — zero warnings
3. `npm run build` — produces `dist/`
4. Manual: add a feed with 500+ items → "All Feeds" shows truly interleaved chrono items; existing feeds show their items when selected
