import { getDb } from './open';
import type { FeedStats, Item } from './types';
import { readToFlag, starToFlag, READ_UNREAD, STAR_UNSTARRED } from './flags';

/**
 * Merge an incoming item into an existing stored record. First-seen state
 * (`createdAt`, and for fallback-dated items `publishedAt`) is preserved so
 * refreshes never re-stamp dates with the refresh time. `dateFallback` is
 * managed explicitly: the spread alone cannot clear it (real-date items
 * carry no key) or keep it across a preserved merge.
 */
function mergeItem(existing: Item, incoming: Item): Item {
  const incomingIsFallback = incoming.dateFallback === true;
  const existingDateUsable = existing.publishedAt <= Date.now();
  const preserveDate = incomingIsFallback && existingDateUsable;
  return {
    ...existing,
    ...incoming,
    read: existing.read,
    starred: existing.starred,
    firstOpenedAt: existing.firstOpenedAt,
    createdAt: existing.createdAt,
    updatedAt: preserveDate ? existing.updatedAt : incoming.updatedAt,
    publishedAt: preserveDate ? existing.publishedAt : incoming.publishedAt,
    dateFallback: preserveDate ? existing.dateFallback : incoming.dateFallback,
    id: existing.id,
  };
}

export async function insertOrUpdateItem(item: Item): Promise<void> {
  await bulkUpsertItems([item]);
}

export async function bulkUpsertItems(items: Item[]): Promise<void> {
  if (items.length === 0) return;
  const db = await getDb();
  const feedId = items[0].feedId;

  // Batch-read existing items and flags for this feed.
  const itemRange = IDBKeyRange.bound([feedId, -Infinity], [feedId, Infinity]);
  const existingItems = await db.getAllFromIndex('items', 'by-feed-published', itemRange);
  const existingByKey = new Map(existingItems.map((e) => [e.id, e]));

  const existingFlags = await db.getAllFromIndex('itemFlags', 'by-feed-id', feedId);
  const flagByKey = new Map(existingFlags.map((f) => [f.id, f]));

  const tx = db.transaction(['items', 'itemFlags', 'feedStats', 'readMarkers'], 'readwrite');
  const itemsStore = tx.objectStore('items');
  const flagsStore = tx.objectStore('itemFlags');
  const statsStore = tx.objectStore('feedStats');
  const markersStore = tx.objectStore('readMarkers');
  const statsByFeed = new Map<string, FeedStats>();

  const getStats = async (feedId: string): Promise<FeedStats> => {
    const cached = statsByFeed.get(feedId);
    if (cached) return cached;
    const existing = await statsStore.get(feedId);
    const stats: FeedStats = existing ?? {
      feedId,
      totalSeen: 0,
      readOnce: 0,
      serverReadOnce: 0,
      title: '',
      url: '',
    };
    statsByFeed.set(feedId, stats);
    return stats;
  };

  for (const item of items) {
    const existing = existingByKey.get(item.id);
    if (existing) {
      const merged = mergeItem(existing, item);
      if (item.html) merged.extractedHtml = null;
      await itemsStore.put(merged);
      const flag = flagByKey.get(item.id);
      await flagsStore.put({
        id: item.id,
        feedId: item.feedId,
        read: flag ? flag.read : readToFlag(existing.read),
        starred: flag ? flag.starred : starToFlag(existing.starred),
      });
      existingByKey.set(item.id, merged);
    } else {
      await itemsStore.put(item);
      const existingFlag = flagByKey.get(item.id);
      await flagsStore.put({
        id: item.id,
        feedId: item.feedId,
        read: existingFlag ? existingFlag.read : readToFlag(item.read),
        starred: existingFlag ? existingFlag.starred : starToFlag(item.starred),
      });
      existingByKey.set(item.id, item);
      const stats = await getStats(item.feedId);
      stats.totalSeen += 1;
      if (item.read && !(await markersStore.get(item.id))) {
        await markersStore.put({ id: item.id, feedId: item.feedId, acknowledged: 0 });
        stats.readOnce += 1;
      }
    }
  }
  for (const stats of statsByFeed.values()) {
    stats.totalSeen = Math.max(stats.totalSeen, stats.readOnce);
    await statsStore.put(stats);
  }
  await tx.done;
}

export async function getItem(id: string): Promise<Item | undefined> {
  const db = await getDb();
  return db.get('items', id);
}

export async function updateItem(
  id: string,
  patch: Partial<Item>,
  options: { trackReadOnce?: boolean } = {},
): Promise<void> {
  const db = await getDb();
  const flagsChanged = 'read' in patch || 'starred' in patch;
  if (flagsChanged) {
    const tx = db.transaction(['items', 'itemFlags', 'feedStats', 'readMarkers'], 'readwrite');
    const itemsStore = tx.objectStore('items');
    const flagsStore = tx.objectStore('itemFlags');
    const statsStore = tx.objectStore('feedStats');
    const markersStore = tx.objectStore('readMarkers');
    const existing = await itemsStore.get(id);
    if (!existing) {
      await tx.done;
      return;
    }
    const updated = { ...existing, ...patch, id };
    await itemsStore.put(updated);
    const flag = await flagsStore.get(id);
    if (flag) {
      await flagsStore.put({
        ...flag,
        read: 'read' in patch ? readToFlag(patch.read!) : flag.read,
        starred: 'starred' in patch ? starToFlag(patch.starred!) : flag.starred,
      });
    }
    if (options.trackReadOnce !== false && patch.read === true && !existing.read) {
      const marker = await markersStore.get(id);
      if (!marker) {
        await markersStore.put({ id, feedId: existing.feedId, acknowledged: 0 });
        const stats = await statsStore.get(existing.feedId) ?? {
          feedId: existing.feedId,
          totalSeen: 0,
          readOnce: 0,
          serverReadOnce: 0,
          title: '',
          url: '',
        } satisfies FeedStats;
        stats.readOnce += 1;
        stats.totalSeen = Math.max(stats.totalSeen, stats.readOnce);
        await statsStore.put(stats);
      }
    }
    await tx.done;
  } else {
    const existing = await db.get('items', id);
    if (!existing) return;
    await db.put('items', { ...existing, ...patch, id });
  }
}

export async function listItemsByFeed(
  feedId: string,
  limit = 500,
): Promise<Item[]> {
  const db = await getDb();
  const range = IDBKeyRange.bound([feedId, -Infinity], [feedId, Infinity]);
  const results: Item[] = [];
  let cursor = await db
    .transaction('items', 'readonly')
    .store.index('by-feed-published')
    .openCursor(range, 'prev');
  while (cursor && results.length < limit) {
    results.push(cursor.value);
    cursor = await cursor.continue();
  }
  return results;
}

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

export async function listUnreadAcrossFeeds(limit = 200): Promise<Item[]> {
  const db = await getDb();
  const results: Item[] = [];
  let cursor = await db
    .transaction('itemFlags', 'readonly')
    .store.index('by-read')
    .openCursor(IDBKeyRange.only(0), 'prev');
  while (cursor && results.length < limit) {
    const item = await db.get('items', cursor.value.id);
    if (item) results.push(item);
    cursor = await cursor.continue();
  }
  results.sort((a, b) => b.publishedAt - a.publishedAt);
  return results;
}

export async function listStarred(limit = 200): Promise<Item[]> {
  const db = await getDb();
  const results: Item[] = [];
  let cursor = await db
    .transaction('itemFlags', 'readonly')
    .store.index('by-starred')
    .openCursor(IDBKeyRange.only(1), 'prev');
  while (cursor && results.length < limit) {
    const item = await db.get('items', cursor.value.id);
    if (item) results.push(item);
    cursor = await cursor.continue();
  }
  results.sort((a, b) => b.publishedAt - a.publishedAt);
  return results;
}

export async function markRead(id: string, read = true): Promise<void> {
  await updateItem(id, { read });
}

export async function toggleStar(id: string): Promise<void> {
  const item = await getItem(id);
  if (!item) return;
  await updateItem(id, { starred: !item.starred });
}

export async function searchItems(query: string, limit = 50, signal?: AbortSignal): Promise<Item[]> {
  const db = await getDb();
  const q = query.toLowerCase();
  const results: Item[] = [];
  let cursor = await db
    .transaction('items', 'readonly')
    .store.index('by-feed-published')
    .openCursor(null, 'prev');
  while (cursor && results.length < limit) {
    if (signal?.aborted) return [];
    const v = cursor.value;
    if (
      v.title.toLowerCase().includes(q) ||
      v.excerpt.toLowerCase().includes(q)
    ) {
      results.push(v);
    }
    cursor = await cursor.continue();
  }
  return results;
}

export async function deleteItemsByFeed(feedId: string): Promise<void> {
  const db = await getDb();
  const tx = db.transaction(['items', 'itemFlags'], 'readwrite');
  const itemsStore = tx.objectStore('items');
  const flagsStore = tx.objectStore('itemFlags');
  const itemIndex = itemsStore.index('by-feed-published');
  let itemCursor = await itemIndex.openCursor(
    IDBKeyRange.bound([feedId, -Infinity], [feedId, Infinity]),
  );
  while (itemCursor) {
    itemCursor.delete();
    itemCursor = await itemCursor.continue();
  }
  let flagCursor = await flagsStore.index('by-feed-id').openCursor(IDBKeyRange.only(feedId));
  while (flagCursor) {
    flagCursor.delete();
    flagCursor = await flagCursor.continue();
  }
  await tx.done;
}
