import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import { DB_NAME, DB_VERSION, type Feed, type Item, type Meta } from './types';

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
    };
  };
  meta: {
    key: string;
    value: Meta;
  };
}

let dbPromise: Promise<IDBPDatabase<RssReaderDB>> | null = null;

export function getDb(): Promise<IDBPDatabase<RssReaderDB>> {
  if (!dbPromise) {
    dbPromise = openDB<RssReaderDB>(DB_NAME, DB_VERSION, {
      upgrade(db) {
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
      },
    });
  }
  return dbPromise;
}