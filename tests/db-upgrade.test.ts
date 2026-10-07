import 'fake-indexeddb/auto';
import { describe, it, expect, afterEach, vi } from 'vitest';
import { openDB, type IDBPDatabase, type OpenDBCallbacks } from 'idb';
import { upgradeDb } from '../src/db/open';
import { DB_NAME, DB_VERSION } from '../src/db/types';

type AnyDb = IDBPDatabase;

const upgrade = upgradeDb as unknown as NonNullable<OpenDBCallbacks<unknown>['upgrade']>;

const FRESH_LAYOUT: Record<string, { keyPath: string; indexes: Record<string, string | string[]> }> = {
  feeds: { keyPath: 'id', indexes: { 'by-url': 'url' } },
  items: {
    keyPath: 'id',
    indexes: { 'by-feed-published': ['feedId', 'publishedAt'], 'by-guid': 'guid', 'by-published': 'publishedAt', 'by-last-seen': ['lastSeenAt', 'id'] },
  },
  itemBodies: { keyPath: 'id', indexes: { 'by-feed-id': 'feedId' } },
  itemFlags: { keyPath: 'id', indexes: { 'by-read': 'read', 'by-starred': 'starred', 'by-feed-id': 'feedId' } },
  meta: { keyPath: 'key', indexes: {} },
  feedStats: { keyPath: 'feedId', indexes: {} },
  readMarkers: { keyPath: 'id', indexes: { 'by-feed-id': 'feedId', 'by-acknowledged': 'acknowledged' } },
};

let counter = 0;
const names: string[] = [];

function freshName(): string {
  const name = `${DB_NAME}-upgrade-${counter++}`;
  names.push(name);
  return name;
}

afterEach(() => {
  vi.restoreAllMocks();
});

function describeLayout(db: AnyDb): typeof FRESH_LAYOUT {
  const layout: typeof FRESH_LAYOUT = {};
  for (const name of Array.from(db.objectStoreNames)) {
    const store = db.transaction(name, 'readonly').store;
    const indexes: Record<string, string | string[]> = {};
    for (const indexName of Array.from(store.indexNames)) indexes[indexName] = store.index(indexName).keyPath as string | string[];
    layout[name] = { keyPath: store.keyPath as string, indexes };
  }
  return layout;
}

async function seedV9(name: string, options: { withBodiesStore?: boolean } = {}): Promise<void> {
  const db = await openDB(name, 9, {
    upgrade(upgrading) {
      upgrading.createObjectStore('feeds', { keyPath: 'id' }).createIndex('by-url', 'url');
      const items = upgrading.createObjectStore('items', { keyPath: 'id' });
      items.createIndex('by-feed-published', ['feedId', 'publishedAt']);
      items.createIndex('by-guid', 'guid');
      items.createIndex('by-published', 'publishedAt');
      const flags = upgrading.createObjectStore('itemFlags', { keyPath: 'id' });
      flags.createIndex('by-read', 'read');
      flags.createIndex('by-starred', 'starred');
      flags.createIndex('by-feed-id', 'feedId');
      upgrading.createObjectStore('meta', { keyPath: 'key' });
      upgrading.createObjectStore('feedStats', { keyPath: 'feedId' });
      const markers = upgrading.createObjectStore('readMarkers', { keyPath: 'id' });
      markers.createIndex('by-feed-id', 'feedId');
      markers.createIndex('by-acknowledged', 'acknowledged');
      if (options.withBodiesStore) upgrading.createObjectStore('itemBodies', { keyPath: 'id' });
    },
  });
  await db.put('feeds', { id: 'f1', url: 'https://x.com/feed.xml', title: 'X', learnedIntervalMs: 3_600_000, lastFetched: null });
  const base = { feedId: 'f1', title: 'T', excerpt: 'e', publishedAt: 1000, updatedAt: 1000, createdAt: 900, read: false, starred: false };
  await db.put('items', { ...base, id: 'f1::both', guid: 'both', html: '<p>feed</p>', extractedHtml: '<p>extracted</p>' });
  await db.put('items', { ...base, id: 'f1::feedonly', guid: 'feedonly', html: '<p>feed only</p>', extractedHtml: null, read: true });
  await db.put('items', { ...base, id: 'f1::extractedonly', guid: 'extractedonly', extractedHtml: '<p>only extracted</p>', starred: true, firstOpenedAt: 950 });
  await db.put('items', { ...base, id: 'f1::none', guid: 'none', extractedHtml: null, thumbnail: 'https://x.com/t.png', dateFallback: true });
  await db.put('items', { ...base, id: 'f1::plain', guid: 'plain' });
  await db.put('itemFlags', { id: 'f1::feedonly', feedId: 'f1', read: 1, starred: 0 });
  await db.put('itemFlags', { id: 'f1::extractedonly', feedId: 'f1', read: 0, starred: 1 });
  await db.put('readMarkers', { id: 'f1::feedonly', feedId: 'f1', acknowledged: 0 });
  await db.put('feedStats', { feedId: 'f1', totalSeen: 5, readOnce: 1, serverReadOnce: 0, title: 'X', url: 'https://x.com/feed.xml' });
  await db.put('meta', { key: 'settings', value: { theme: 'dark', syncKey: 'a'.repeat(22), lastSyncAt: 123, lastItemsCursor: 7 } });
  db.close();
}

async function seedV10(name: string): Promise<void> {
  await seedV9(name, { withBodiesStore: true });
  const db = await openDB(name, 10, {
    async upgrade(upgrading, _oldVersion, _newVersion, transaction) {
      const items = transaction.objectStore('items');
      const bodies = transaction.objectStore('itemBodies');
      bodies.createIndex('by-feed-id', 'feedId');
      let cursor = await items.openCursor();
      while (cursor) {
        const item = cursor.value as Record<string, unknown> & { id: string; feedId: string };
        const { html, extractedHtml, ...record } = item;
        if (html || extractedHtml) {
          await bodies.put({ id: item.id, feedId: item.feedId, ...(html ? { html } : {}), ...(extractedHtml ? { extractedHtml } : {}) });
        }
        await cursor.update(record);
        cursor = await cursor.continue();
      }
    },
  });
  db.close();
}

async function snapshot(db: AnyDb, store: string): Promise<unknown[]> {
  return db.getAll(store);
}

describe('database version 11', () => {
  it('is the current version', () => {
    expect(DB_VERSION).toBe(11);
  });

  it('creates the version 11 layout directly for a new database', async () => {
    const db = await openDB(freshName(), DB_VERSION, { upgrade });
    expect(db.version).toBe(11);
    expect(describeLayout(db)).toEqual(FRESH_LAYOUT);
    for (const store of Object.keys(FRESH_LAYOUT)) expect(await db.count(store)).toBe(0);
    db.close();
  });

  it('migrates a version 9 database and stamps items while dropping bodies from article records', async () => {
    const name = freshName();
    await seedV9(name);
    const before = await openDB(name, 9);
    const untouched = ['feeds', 'itemFlags', 'readMarkers', 'feedStats', 'meta'];
    const expected = Object.fromEntries(await Promise.all(untouched.map(async (store) => [store, await snapshot(before, store)])));
    const itemsBefore = await snapshot(before, 'items') as Array<Record<string, unknown>>;
    before.close();

    const db = await openDB(name, DB_VERSION, { upgrade });
    expect(db.version).toBe(11);
    expect(describeLayout(db)).toEqual(FRESH_LAYOUT);

    for (const store of untouched) expect(await snapshot(db, store)).toEqual(expected[store]);

    const items = await snapshot(db, 'items') as Array<Record<string, unknown>>;
    expect(items).toHaveLength(itemsBefore.length);
    for (const item of items) {
      expect('html' in item).toBe(false);
      expect('extractedHtml' in item).toBe(false);
      const original = itemsBefore.find((candidate) => candidate.id === item.id)!;
      const { html: _html, extractedHtml: _extracted, ...rest } = original;
      expect(item).toEqual({ ...rest, lastSeenAt: expect.any(Number) });
    }

    expect(await db.count('itemBodies')).toBe(0);
    db.close();
  });

  it('streams items with a cursor instead of loading them all', async () => {
    const name = freshName();
    await seedV9(name);
    const getAll = vi.spyOn(IDBObjectStore.prototype, 'getAll');
    const openCursor = vi.spyOn(IDBObjectStore.prototype, 'openCursor');
    const db = await openDB(name, DB_VERSION, { upgrade });
    expect(openCursor).toHaveBeenCalled();
    expect(getAll).not.toHaveBeenCalled();
    db.close();
  });

  it('migrates version 10 items in place and preserves body records', async () => {
    const name = freshName();
    await seedV10(name);
    const before = await openDB(name, 10);
    const feed = await before.get('feeds', 'f1');
    const body = await before.get('itemBodies', 'f1::both');
    const flags = await snapshot(before, 'itemFlags');
    before.close();

    const db = await openDB(name, DB_VERSION, { upgrade });
    expect(db.version).toBe(11);
    expect(await db.get('feeds', 'f1')).toEqual(feed);
    expect(await db.get('itemBodies', 'f1::both')).toEqual(body);
    expect(await snapshot(db, 'itemFlags')).toEqual(flags);
    for (const item of await db.getAll('items')) expect(item.lastSeenAt).toEqual(expect.any(Number));
    expect(db.transaction('items').store.indexNames.contains('by-last-seen')).toBe(true);
    db.close();
  });

  it('leaves a version 9 database intact when the migration fails', async () => {
    const name = freshName();
    await seedV9(name, { withBodiesStore: true });
    vi.spyOn(console, 'error').mockImplementation(() => {});

    await expect(openDB(name, DB_VERSION, { upgrade })).rejects.toThrow();

    const db = await openDB(name, 9);
    expect(db.version).toBe(9);
    expect(await db.count('items')).toBe(5);
    expect(await db.get('items', 'f1::both')).toMatchObject({ html: '<p>feed</p>', extractedHtml: '<p>extracted</p>' });
    expect(await db.count('itemBodies')).toBe(0);
    db.close();
  });

  it.each([2, 5, 8])('resets a version %i database to an empty version 11 layout', async (version) => {
    const name = freshName();
    const old = await openDB(name, version, {
      upgrade(upgrading) {
        upgrading.createObjectStore('feeds', { keyPath: 'url' });
        upgrading.createObjectStore('items', { keyPath: 'id' }).createIndex('by-guid', 'guid');
        upgrading.createObjectStore('meta', { keyPath: 'key' });
        upgrading.createObjectStore('legacyStore', { keyPath: 'id' });
      },
    });
    await old.put('feeds', { url: 'https://x.com/feed.xml', title: 'X' });
    await old.put('items', { id: 'https://x.com/feed.xml::a', guid: 'a', html: '<p>old</p>' });
    await old.put('meta', { key: 'settings', value: { syncKey: 'a'.repeat(22) } });
    old.close();

    const db = await openDB(name, DB_VERSION, { upgrade });
    expect(db.version).toBe(11);
    expect(describeLayout(db)).toEqual(FRESH_LAYOUT);
    for (const store of Object.keys(FRESH_LAYOUT)) expect(await db.count(store)).toBe(0);
    db.close();
  });
});
