import { getDb } from './open';
import type { Item } from './types';

export const BODY_RETENTION_MS = 90 * 24 * 60 * 60 * 1000;
export const UNREAD_ITEM_RETENTION_MS = 365 * 24 * 60 * 60 * 1000;
const RETENTION_SCAN_BATCH = 500;

export interface StorageStatus {
  usage: number | null;
  quota: number | null;
  persistent: boolean | null;
  items: number;
  bodies: number;
}

export async function getStorageStatus(): Promise<StorageStatus> {
  const db = await getDb();
  const storage = typeof navigator === 'undefined' ? undefined : navigator.storage;
  const [estimate, persistent, items, bodies] = await Promise.all([
    storage?.estimate?.().catch(() => undefined),
    storage?.persisted?.().catch(() => undefined),
    db.count('items'),
    db.count('itemBodies'),
  ]);
  return {
    usage: estimate?.usage ?? null,
    quota: estimate?.quota ?? null,
    persistent: persistent ?? null,
    items,
    bodies,
  };
}

export async function requestPersistentStorage(force = false): Promise<boolean | null> {
  const storage = typeof navigator === 'undefined' ? undefined : navigator.storage;
  if (!storage?.persist || !storage?.persisted) return null;
  const db = await getDb();
  const existing = await db.get('meta', 'persistent-storage-requested');
  if (!force && existing) return storage.persisted();
  const granted = await storage.persist().catch(() => false);
  await db.put('meta', { key: 'persistent-storage-requested', value: true });
  return granted;
}

export async function requestPersistenceAfterFirstFeed(): Promise<void> {
  const db = await getDb();
  const existing = await db.get('meta', 'persistent-storage-requested');
  if (!existing) await requestPersistentStorage();
}

export async function runStorageRetention(now = Date.now()): Promise<{ bodies: number; items: number }> {
  const db = await getDb();
  const bodyCutoff = now - BODY_RETENTION_MS;
  const itemCutoff = now - UNREAD_ITEM_RETENTION_MS;
  let bodiesDeleted = 0;
  let itemsDeleted = 0;

  {
    const tx = db.transaction(['items', 'itemBodies', 'meta'], 'readwrite');
    const items = tx.objectStore('items');
    const bodies = tx.objectStore('itemBodies');
    const meta = tx.objectStore('meta');
    const cursorKey = await meta.get('retention-body-cursor');
    const priorKey = cursorKey?.value as [number, string] | undefined;
    let cursor = await items.index('by-last-seen').openCursor(
      priorKey && priorKey[0] <= bodyCutoff ? IDBKeyRange.bound(priorKey, [bodyCutoff, '\uffff'], true) : IDBKeyRange.upperBound([bodyCutoff, '\uffff']),
    );
    let scanned = 0;
    let lastKey: [number, string] | null = null;
    while (cursor && scanned < RETENTION_SCAN_BATCH) {
      scanned += 1;
      lastKey = cursor.key as [number, string];
      const item = cursor.value as Item;
      if (!item.starred && await bodies.getKey(item.id) !== undefined) {
        await bodies.delete(item.id);
        bodiesDeleted += 1;
      }
      cursor = await cursor.continue();
    }
    if (cursor && lastKey) await meta.put({ key: 'retention-body-cursor', value: lastKey });
    else await meta.delete('retention-body-cursor');
    await tx.done;
  }

  {
    const tx = db.transaction(['items', 'itemBodies', 'itemFlags', 'readMarkers', 'meta'], 'readwrite');
    const items = tx.objectStore('items');
    const bodies = tx.objectStore('itemBodies');
    const flags = tx.objectStore('itemFlags');
    const markers = tx.objectStore('readMarkers');
    const meta = tx.objectStore('meta');
    const cursorKey = await meta.get('retention-item-cursor');
    const priorKey = cursorKey?.value as [number, string] | undefined;
    let cursor = await items.index('by-last-seen').openCursor(
      priorKey && priorKey[0] <= itemCutoff ? IDBKeyRange.bound(priorKey, [itemCutoff, '\uffff'], true) : IDBKeyRange.upperBound([itemCutoff, '\uffff']),
    );
    let scanned = 0;
    let lastKey: [number, string] | null = null;
    while (cursor && scanned < RETENTION_SCAN_BATCH) {
      scanned += 1;
      lastKey = cursor.key as [number, string];
      const item = cursor.value as Item;
      const flag = await flags.get(item.id);
      const read = flag ? flag.read === 1 : item.read;
      const starred = flag ? flag.starred === 1 : item.starred;
      if (!read && !starred) {
        await cursor.delete();
        await bodies.delete(item.id);
        await flags.delete(item.id);
        await markers.delete(item.id);
        itemsDeleted += 1;
      }
      cursor = await cursor.continue();
    }
    if (cursor && lastKey) await meta.put({ key: 'retention-item-cursor', value: lastKey });
    else await meta.delete('retention-item-cursor');
    await tx.done;
  }

  return { bodies: bodiesDeleted, items: itemsDeleted };
}
