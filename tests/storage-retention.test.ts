import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getDb } from '../src/db/open';
import { bulkUpsertItems, getItem, getItemBody } from '../src/db/items';
import { getStorageStatus, requestPersistentStorage, runStorageRetention, BODY_RETENTION_MS, UNREAD_ITEM_RETENTION_MS } from '../src/db/storage-retention';
import type { ItemInput } from '../src/db/types';

function item(id: string, overrides: Partial<ItemInput> = {}): ItemInput {
  return {
    id: `f1::${id}`,
    feedId: 'f1',
    guid: id,
    title: id,
    excerpt: 'summary',
    publishedAt: 1,
    updatedAt: 1,
    read: false,
    starred: false,
    createdAt: 1,
    html: '<p>body</p>',
    ...overrides,
  };
}

beforeEach(async () => {
  const db = await getDb();
  for (const store of ['feeds', 'items', 'itemBodies', 'itemFlags', 'meta', 'feedStats', 'readMarkers'] as const) await db.clear(store);
});

const originalStorage = Object.getOwnPropertyDescriptor(navigator, 'storage');
afterEach(() => {
  if (originalStorage) Object.defineProperty(navigator, 'storage', originalStorage);
  else Reflect.deleteProperty(navigator, 'storage');
});

function setStorageApi(storage: Partial<StorageManager>): void {
  Object.defineProperty(navigator, 'storage', { configurable: true, value: storage });
}

async function age(id: string, lastSeenAt: number): Promise<void> {
  const db = await getDb();
  const record = await db.get('items', id);
  await db.put('items', { ...record!, lastSeenAt });
}

describe('local storage retention', () => {
  it('requests persistence once automatically and permits an explicit retry', async () => {
    const persist = vi.fn().mockResolvedValue(false);
    const persisted = vi.fn().mockResolvedValue(false);
    setStorageApi({ persist, persisted });

    expect(await requestPersistentStorage()).toBe(false);
    expect(await requestPersistentStorage()).toBe(false);
    expect(persist).toHaveBeenCalledTimes(1);
    expect(await requestPersistentStorage(true)).toBe(false);
    expect(persist).toHaveBeenCalledTimes(2);
  });

  it('reports browser estimates and local item counts', async () => {
    setStorageApi({
      estimate: vi.fn().mockResolvedValue({ usage: 1024, quota: 4096 }),
      persisted: vi.fn().mockResolvedValue(true),
    });
    await bulkUpsertItems([item('status')]);

    expect(await getStorageStatus()).toEqual({ usage: 1024, quota: 4096, persistent: true, items: 1, bodies: 1 });
  });

  it('deletes an expired unstarred body while keeping the item', async () => {
    const now = Date.now();
    await bulkUpsertItems([item('old')]);
    await age('f1::old', now - BODY_RETENTION_MS);

    expect(await runStorageRetention(now)).toMatchObject({ bodies: 1 });
    expect(await getItemBody('f1::old')).toBeUndefined();
    expect(await getItem('f1::old')).toBeDefined();
  });

  it('keeps starred bodies and old read records', async () => {
    const now = Date.now();
    await bulkUpsertItems([item('starred', { starred: true }), item('read', { read: true })]);
    await age('f1::starred', now - UNREAD_ITEM_RETENTION_MS * 2);
    await age('f1::read', now - UNREAD_ITEM_RETENTION_MS * 2);

    await runStorageRetention(now);
    expect(await getItemBody('f1::starred')).toBeDefined();
    expect(await getItem('f1::starred')).toBeDefined();
    expect(await getItemBody('f1::read')).toBeUndefined();
    expect(await getItem('f1::read')).toBeDefined();
  });

  it('removes an expired unread item with its related records', async () => {
    const now = Date.now();
    await bulkUpsertItems([item('unread')]);
    const db = await getDb();
    await db.put('readMarkers', { id: 'f1::unread', feedId: 'f1', acknowledged: 0 });
    await age('f1::unread', now - UNREAD_ITEM_RETENTION_MS);

    expect(await runStorageRetention(now)).toMatchObject({ items: 1 });
    expect(await getItem('f1::unread')).toBeUndefined();
    expect(await getItemBody('f1::unread')).toBeUndefined();
    expect(await db.get('itemFlags', 'f1::unread')).toBeUndefined();
    expect(await db.get('readMarkers', 'f1::unread')).toBeUndefined();
  });

  it('refreshes lastSeenAt when insert-only sync returns an existing item', async () => {
    await bulkUpsertItems([item('sync')]);
    await age('f1::sync', 1);
    const before = Date.now();
    await bulkUpsertItems([item('sync')], { insertOnly: true });
    expect((await getItem('f1::sync'))?.lastSeenAt).toBeGreaterThanOrEqual(before);
  });

  it('continues bounded body cleanup across sweeps', async () => {
    const now = Date.now();
    const inputs = Array.from({ length: 501 }, (_, index) => item(`old-${String(index).padStart(4, '0')}`, { read: true }));
    await bulkUpsertItems(inputs);
    const db = await getDb();
    const tx = db.transaction('items', 'readwrite');
    for (const record of await tx.store.getAll()) await tx.store.put({ ...record, lastSeenAt: now - BODY_RETENTION_MS });
    await tx.done;

    expect(await runStorageRetention(now)).toMatchObject({ bodies: 500 });
    expect(await runStorageRetention(now)).toMatchObject({ bodies: 1 });
  });
});
