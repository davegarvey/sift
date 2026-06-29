import { getDb } from './open';
import type { Item } from './types';

export async function insertOrUpdateItem(item: Item): Promise<void> {
  const db = await getDb();
  const existing = await db.get('items', item.id);
  if (existing) {
    // Preserve user state when upstream updates content.
    await db.put('items', {
      ...existing,
      ...item,
      read: existing.read,
      starred: existing.starred,
      firstOpenedAt: existing.firstOpenedAt,
      extractedHtml: existing.extractedHtml ?? item.extractedHtml ?? null,
      id: existing.id,
    });
  } else {
    await db.put('items', item);
  }
}

/**
 * Upsert many items in a single IndexedDB transaction. Always preserves
 * user state (read, starred, firstOpenedAt, extractedHtml).
 */
export async function bulkUpsertItems(items: Item[]): Promise<void> {
  const db = await getDb();
  const tx = db.transaction('items', 'readwrite');
  for (const item of items) {
    const existing = await tx.store.get(item.id);
    if (existing) {
      await tx.store.put({
        ...existing,
        ...item,
        read: existing.read,
        starred: existing.starred,
        firstOpenedAt: existing.firstOpenedAt,
        extractedHtml: existing.extractedHtml ?? item.extractedHtml ?? null,
        id: existing.id,
      });
    } else {
      await tx.store.put(item);
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
  const existing = await db.get('items', id);
  if (!existing) return;
  await db.put('items', { ...existing, ...patch, id });
}

export async function listItemsByFeed(
  feedUrl: string,
  limit = 500,
): Promise<Item[]> {
  const db = await getDb();
  const range = IDBKeyRange.bound([feedUrl, -Infinity], [feedUrl, Infinity]);
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
    .store.index('by-feed-published')
    .openCursor(null, 'prev');
  while (cursor && results.length < limit) {
    results.push(cursor.value);
    cursor = await cursor.continue();
  }
  return results;
}

export async function listUnreadAcrossFeeds(limit = 200): Promise<Item[]> {
  const db = await getDb();
  // by-feed-read index has [feedUrl, read]; we want all where read === 0.
  // Cheaper: iterate the store's by-feed-published index in reverse and filter.
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

export async function listStarred(limit = 200): Promise<Item[]> {
  const db = await getDb();
  const results: Item[] = [];
  // Note: IDB does not accept booleans as index keys, so we manually filter
  // by walking the by-feed-published index in reverse-chrono order.
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

export async function markRead(id: string, read = true): Promise<void> {
  await updateItem(id, { read });
}

export async function toggleStar(id: string): Promise<void> {
  const item = await getItem(id);
  if (!item) return;
  await updateItem(id, { starred: !item.starred });
}

export async function searchItems(query: string, limit = 50): Promise<Item[]> {
  const db = await getDb();
  const q = query.toLowerCase();
  const results: Item[] = [];
  let cursor = await db
    .transaction('items', 'readonly')
    .store.index('by-feed-published')
    .openCursor(null, 'prev');
  while (cursor && results.length < limit) {
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

export async function deleteItemsByFeed(feedUrl: string): Promise<void> {
  const db = await getDb();
  const tx = db.transaction('items', 'readwrite');
  const index = tx.store.index('by-feed-published');
  let cursor = await index.openCursor(
    IDBKeyRange.bound([feedUrl, -Infinity], [feedUrl, Infinity]),
  );
  while (cursor) {
    await cursor.delete();
    cursor = await cursor.continue();
  }
  await tx.done;
}