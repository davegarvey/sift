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
      'by-feed-id': string;
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
    batch.push({ id: v.id, feedId: v.feedId, read: v.read ? 1 : 0, starred: v.starred ? 1 : 0 });
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
      upgrade: async (db, _oldVersion, _newVersion, transaction) => {
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
            (flags.createIndex as any)('by-feed-url', 'feedUrl');
            flags.createIndex('by-read', 'read');
            flags.createIndex('by-starred', 'starred');
          }
        }
        if (_oldVersion < 4) {
        }
        if (_oldVersion < 5) {
          const tx = transaction as any;
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
      },
    }).then(async (db) => {
      await backfillFlags(db);
      return db;
    });
  }
  return dbPromise;
}
