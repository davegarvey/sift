import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import { DB_NAME, DB_VERSION, type Feed, type Item, type Meta } from './types';
import type { ItemFlag } from './flags';

interface RssReaderDB extends DBSchema {
  feeds: {
    key: string;
    value: Feed;
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
      'by-feed-url': string;
    };
  };
}

let dbPromise: Promise<IDBPDatabase<RssReaderDB>> | null = null;

async function backfillFlags(db: IDBPDatabase<RssReaderDB>): Promise<void> {
  const meta = await db.get('meta', 'flagsBackfilled');
  if (meta?.value) return;
  const itemsTx = db.transaction('items', 'readonly');
  let cursor = await itemsTx.store.index('by-feed-published').openCursor();
  const batch: ItemFlag[] = [];
  while (cursor) {
    const v = cursor.value;
    batch.push({ id: v.id, feedUrl: v.feedUrl, read: v.read ? 1 : 0, starred: v.starred ? 1 : 0 });
    if (batch.length >= 10000) {
      const wtx = db.transaction('itemFlags', 'readwrite');
      for (const flag of batch) await wtx.store.put(flag);
      await wtx.done;
      batch.length = 0;
    }
    cursor = await cursor.continue();
  }
  if (batch.length > 0) {
    const wtx = db.transaction('itemFlags', 'readwrite');
    for (const flag of batch) await wtx.store.put(flag);
    await wtx.done;
  }
  await db.put('meta', { key: 'flagsBackfilled', value: true });
}

export function getDb(): Promise<IDBPDatabase<RssReaderDB>> {
  if (!dbPromise) {
    dbPromise = openDB<RssReaderDB>(DB_NAME, DB_VERSION, {
      upgrade(db, _oldVersion, _newVersion, transaction) {
        if (!db.objectStoreNames.contains('feeds')) {
          db.createObjectStore('feeds', { keyPath: 'url' });
        }
        if (!db.objectStoreNames.contains('items')) {
          const items = db.createObjectStore('items', { keyPath: 'id' });
          items.createIndex('by-feed-published', ['feedUrl', 'publishedAt']);
          // Note: IDB does not accept booleans as index keys, so `read` and
          // `starred` are not usable as index key fields. Reads/unreads/starred
          // queries iterate the by-feed-published index and filter in JS.
          // See design.md divergence note for spec capability `feed-management`.
          items.createIndex('by-guid', 'guid');
        }
        if (!db.objectStoreNames.contains('meta')) {
          db.createObjectStore('meta', { keyPath: 'key' });
        }
        // v2: add by-published index for global chronological queries
        if (_oldVersion < 2) {
          const store = transaction.objectStore('items');
          if (!store.indexNames.contains('by-published')) {
            store.createIndex('by-published', 'publishedAt');
          }
        }
        // v3: add itemFlags store for boolean-indexed read/starred queries
        if (_oldVersion < 3) {
          if (!db.objectStoreNames.contains('itemFlags')) {
            const flags = db.createObjectStore('itemFlags', { keyPath: 'id' });
            flags.createIndex('by-read', 'read');
            flags.createIndex('by-starred', 'starred');
            flags.createIndex('by-feed-url', 'feedUrl');
          }
        }
      },
    }).then(async (db) => {
      await backfillFlags(db);
      return db;
    });
  }
  return dbPromise;
}