import { openDB, type DBSchema, type IDBPDatabase, type IDBPTransaction, type StoreNames } from 'idb';
import { DB_NAME, DB_VERSION, type Feed, type FeedStats, type Item, type Meta, type ReadMarker } from './types';
import type { ItemFlag } from './flags';

interface BaseRssReaderDB extends DBSchema {
  feeds: {
    key: string;
    value: Feed;
    indexes: {
      'by-url': string;
    };
  };
  items: {
    key: string;
    value: Item;
    indexes: {
      'by-feed-published': [string, number];
      'by-guid': string;
      'by-published': number;
    };
  };
  meta: {
    key: string;
    value: Meta;
  };
  itemFlags: {
    key: string;
    value: ItemFlag;
    indexes: {
      'by-read': number;
      'by-starred': number;
      'by-feed-id': string;
    };
  };
}

interface RssReaderDB extends BaseRssReaderDB {
  feedStats: {
    key: string;
    value: FeedStats;
    indexes: {};
  };
  readMarkers: {
    key: string;
    value: ReadMarker;
    indexes: {
      'by-feed-id': string;
      'by-acknowledged': number;
    };
  };
}

let dbPromise: Promise<IDBPDatabase<RssReaderDB>> | null = null;

/**
 * Versioned upgrade handler. Runs inside a versionchange transaction —
 * MUST use `transaction.objectStore(...)` (idb convenience methods open
 * their own transactions and throw while a versionchange is in flight).
 * Exported so tests can drive migrations from any old version.
 */
export async function upgradeDb<T extends DBSchema>(
  legacyDb: IDBPDatabase<T>,
  _oldVersion: number,
  _newVersion: number,
  legacyTransaction: IDBPTransaction<T, StoreNames<T>[], 'versionchange'>,
): Promise<void> {
  const db = legacyDb as unknown as IDBPDatabase<RssReaderDB>;
  const transaction = legacyTransaction as unknown as IDBPTransaction<RssReaderDB, StoreNames<RssReaderDB>[], 'versionchange'>;
  if (!db.objectStoreNames.contains('feeds')) {
    db.createObjectStore('feeds', { keyPath: 'url' });
  }
  if (!db.objectStoreNames.contains('items')) {
    const items = db.createObjectStore('items', { keyPath: 'id' });
    items.createIndex('by-feed-published', ['feedUrl', 'publishedAt']);
    items.createIndex('by-guid', 'guid');
  }
  if (!db.objectStoreNames.contains('meta')) {
    db.createObjectStore('meta', { keyPath: 'key' });
  }
  if (_oldVersion < 2) {
    const store = transaction.objectStore('items');
    if (!store.indexNames.contains('by-published')) {
      store.createIndex('by-published', 'publishedAt');
    }
  }
  if (_oldVersion < 3) {
    if (!db.objectStoreNames.contains('itemFlags')) {
      const flags = db.createObjectStore('itemFlags', { keyPath: 'id' });
      flags.createIndex('by-read', 'read');
      flags.createIndex('by-starred', 'starred');
    }
  }
  if (_oldVersion < 5) {
    const tx = transaction as any; // why: idb Transaction type doesn't include objectStore/cursor from older schema versions
    const oldFeeds: any[] = [];
    let fc = await tx.objectStore('feeds').openCursor();
    while (fc) {
      oldFeeds.push(fc.value);
      fc = await fc.continue();
    }

    const oldItems: any[] = [];
    let ic = await tx.objectStore('items').openCursor();
    while (ic) {
      oldItems.push(ic.value);
      ic = await ic.continue();
    }

    const oldFlags: any[] = [];
    if (db.objectStoreNames.contains('itemFlags')) {
      let flc = await tx.objectStore('itemFlags').openCursor();
      while (flc) {
        oldFlags.push(flc.value);
        flc = await flc.continue();
      }
    }

    const urlToId = new Map<string, string>();
    for (const f of oldFeeds) {
      urlToId.set(f.url as string, crypto.randomUUID());
    }

    db.deleteObjectStore('feeds');
    db.deleteObjectStore('items');
    if (db.objectStoreNames.contains('itemFlags')) {
      db.deleteObjectStore('itemFlags');
    }

    const feedsStore = db.createObjectStore('feeds', { keyPath: 'id' });

    const itemsStore = db.createObjectStore('items', { keyPath: 'id' });
    itemsStore.createIndex('by-feed-published', ['feedId', 'publishedAt']);
    itemsStore.createIndex('by-guid', 'guid');
    itemsStore.createIndex('by-published', 'publishedAt');

    const flagsStore = db.createObjectStore('itemFlags', { keyPath: 'id' });
    flagsStore.createIndex('by-read', 'read');
    flagsStore.createIndex('by-starred', 'starred');
    flagsStore.createIndex('by-feed-id', 'feedId');

    for (const f of oldFeeds) {
      await feedsStore.put(Object.assign({}, f, { id: urlToId.get(f.url as string)! }));
    }

    for (const item of oldItems) {
      const feedId = urlToId.get(item.feedUrl as string);
      if (!feedId) continue;
      const guid = item.guid as string;
      const { feedUrl: _fu, ...rest } = item;
      await itemsStore.put(Object.assign({}, rest, { id: `${feedId}::${guid}`, feedId }));
    }

    for (const flag of oldFlags) {
      const oldId = flag.id as string;
      const lastSep = oldId.lastIndexOf('::');
      if (lastSep === -1) continue;
      const oldFeedUrl = oldId.slice(0, lastSep);
      const feedId = urlToId.get(oldFeedUrl);
      if (!feedId) continue;
      const guid = oldId.slice(lastSep + 2);
      await flagsStore.put(Object.assign({}, flag, { id: `${feedId}::${guid}`, feedId }));
    }
  }
  if (_oldVersion < 6) {
    const store = transaction.objectStore('feeds');
    if (!store.indexNames.contains('by-url')) {
      store.createIndex('by-url', 'url', { unique: false });
    }
  }
  if (_oldVersion < 7) {
    const itemsStore = transaction.objectStore('items');
    const flagsStore = transaction.objectStore('itemFlags');
    const metaStore = transaction.objectStore('meta');

    // Repair items with future publish dates: fall back to first-seen time.
    let cursor = await itemsStore.openCursor();
    while (cursor) {
      const item = cursor.value as Item;
      if (item.publishedAt > Date.now()) {
        const fallback = Math.min(item.createdAt ?? Date.now(), Date.now());
        await cursor.update({ ...item, publishedAt: fallback, updatedAt: fallback, dateFallback: true });
      }
      cursor = await cursor.continue();
    }

    // Backfill itemFlags rows for items missing them (only-if-missing).
    let itemCursor = await itemsStore.openCursor();
    while (itemCursor) {
      const item = itemCursor.value as Item;
      const flag = await flagsStore.get(item.id);
      if (!flag) {
        await flagsStore.put({
          id: item.id,
          feedId: item.feedId,
          read: item.read ? 1 : 0,
          starred: item.starred ? 1 : 0,
        });
      }
      itemCursor = await itemCursor.continue();
    }

    // Drop the stale backfill marker — the flags backfill is now versioned.
    await metaStore.delete('flagsBackfilled');
  }
  if (_oldVersion < 8) {
    const feedStatsStore = db.objectStoreNames.contains('feedStats')
      ? transaction.objectStore('feedStats')
      : db.createObjectStore('feedStats', { keyPath: 'feedId' });
    const readMarkersStore = db.objectStoreNames.contains('readMarkers')
      ? transaction.objectStore('readMarkers')
      : db.createObjectStore('readMarkers', { keyPath: 'id' });
    if (!readMarkersStore.indexNames.contains('by-feed-id')) {
      readMarkersStore.createIndex('by-feed-id', 'feedId');
    }
    if (!readMarkersStore.indexNames.contains('by-acknowledged')) {
      readMarkersStore.createIndex('by-acknowledged', 'acknowledged');
    }

    const feedStats = new Map<string, FeedStats>();
    const feedsStore = transaction.objectStore('feeds');
    let feedCursor = await feedsStore.openCursor();
    while (feedCursor) {
      const feed = feedCursor.value as Feed;
      feedStats.set(feed.id, {
        feedId: feed.id,
        totalSeen: 0,
        readOnce: 0,
        serverReadOnce: 0,
        title: feed.title,
        url: feed.url,
      });
      feedCursor = await feedCursor.continue();
    }

    const flagsStore = transaction.objectStore('itemFlags');
    const itemsStore = transaction.objectStore('items');
    let itemCursor = await itemsStore.openCursor();
    while (itemCursor) {
      const item = itemCursor.value as Item;
      const stats = feedStats.get(item.feedId) ?? {
        feedId: item.feedId,
        totalSeen: 0,
        readOnce: 0,
        serverReadOnce: 0,
        title: '',
        url: '',
      };
      stats.totalSeen += 1;
      const flag = await flagsStore.get(item.id);
      const seededRead = item.firstOpenedAt != null || flag?.read === 1 || item.read;
      if (seededRead) {
        await readMarkersStore.put({ id: item.id, feedId: item.feedId, acknowledged: 0 });
        stats.readOnce += 1;
      }
      feedStats.set(item.feedId, stats);
      itemCursor = await itemCursor.continue();
    }
    for (const stats of feedStats.values()) {
      await feedStatsStore.put(stats);
    }
  }
}

export function getDb(): Promise<IDBPDatabase<RssReaderDB>> {
  if (!dbPromise) {
    dbPromise = openDB<RssReaderDB>(DB_NAME, DB_VERSION, {
      upgrade: upgradeDb,
    });
  }
  return dbPromise;
}
