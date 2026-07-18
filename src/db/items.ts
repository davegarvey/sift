import { getDb } from './open';
import type { Item } from './types';
import { readToFlag, starToFlag, READ_UNREAD, STAR_UNSTARRED } from './flags';

export async function insertOrUpdateItem(item: Item): Promise<void> {
  const db = await getDb();
  const existing = await db.get('items', item.id);
  if (existing) {
    const merged = { ...existing, ...item, read: existing.read, starred: existing.starred, firstOpenedAt: existing.firstOpenedAt, id: existing.id };
    if (item.html) merged.extractedHtml = null;
    await db.put('items', merged);
    const flag = await db.get('itemFlags', item.id);
    await db.put('itemFlags', {
      id: item.id,
      feedId: item.feedId,
      read: flag ? flag.read : readToFlag(existing.read),
      starred: flag ? flag.starred : starToFlag(existing.starred),
    });
  } else {
    await db.put('items', item);
    const existingFlag = await db.get('itemFlags', item.id);
    await db.put('itemFlags', {
      id: item.id,
      feedId: item.feedId,
      read: existingFlag ? existingFlag.read : readToFlag(item.read),
      starred: existingFlag ? existingFlag.starred : starToFlag(item.starred),
    });
  }
}

export async function bulkUpsertItems(items: Item[]): Promise<void> {
  const db = await getDb();
  const tx = db.transaction(['items', 'itemFlags'], 'readwrite');
  const itemsStore = tx.objectStore('items');
  const flagsStore = tx.objectStore('itemFlags');
  for (const item of items) {
    const existing = await itemsStore.get(item.id);
    if (existing) {
      const merged = { ...existing, ...item, read: existing.read, starred: existing.starred, firstOpenedAt: existing.firstOpenedAt, id: existing.id };
      if (item.html) merged.extractedHtml = null;
      await itemsStore.put(merged);
      const flag = await flagsStore.get(item.id);
      await flagsStore.put({
        id: item.id,
        feedId: item.feedId,
        read: flag ? flag.read : readToFlag(existing.read),
        starred: flag ? flag.starred : starToFlag(existing.starred),
      });
    } else {
      await itemsStore.put(item);
      const existingFlag = await flagsStore.get(item.id);
      await flagsStore.put({
        id: item.id,
        feedId: item.feedId,
        read: existingFlag ? existingFlag.read : readToFlag(item.read),
        starred: existingFlag ? existingFlag.starred : starToFlag(item.starred),
      });
    }
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
): Promise<void> {
  const db = await getDb();
  const flagsChanged = 'read' in patch || 'starred' in patch;
  if (flagsChanged) {
    const tx = db.transaction(['items', 'itemFlags'], 'readwrite');
    const itemsStore = tx.objectStore('items');
    const flagsStore = tx.objectStore('itemFlags');
    const existing = await itemsStore.get(id);
    if (!existing) return;
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
  const backfilled = await db.get('meta', 'flagsBackfilled');
  if (!backfilled?.value) {
    const results: Item[] = [];
    let cursor = await db
      .transaction('items', 'readonly')
      .store.index('by-feed-published')
      .openCursor(null, 'prev');
    while (cursor && results.length < limit) {
      if (!cursor.value.read) results.push(cursor.value);
      cursor = await cursor.continue();
    }
    return results;
  }
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
  const backfilled = await db.get('meta', 'flagsBackfilled');
  if (!backfilled?.value) {
    const results: Item[] = [];
    let cursor = await db
      .transaction('items', 'readonly')
      .store.index('by-feed-published')
      .openCursor(null, 'prev');
    while (cursor && results.length < limit) {
      if (cursor.value.starred) results.push(cursor.value);
      cursor = await cursor.continue();
    }
    return results;
  }
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
