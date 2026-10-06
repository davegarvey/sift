import { openDB, type DBSchema, type IDBPDatabase, type IDBPTransaction, type StoreNames } from 'idb';
import { DB_NAME, DB_VERSION, type Feed, type FeedStats, type Item, type ItemBody, type Meta, type ReadMarker } from './types';
import type { ItemFlag } from './flags';

interface RssReaderDB extends DBSchema {
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
  itemBodies: {
    key: string;
    value: ItemBody;
    indexes: {
      'by-feed-id': string;
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

type VersionChangeTransaction = IDBPTransaction<RssReaderDB, StoreNames<RssReaderDB>[], 'versionchange'>;

type StoredItemWithBodies = Item & { html?: string; extractedHtml?: string | null };

const PREVIOUS_VERSION = 9;

let dbPromise: Promise<IDBPDatabase<RssReaderDB>> | null = null;
let dbBlocked = false;
const blockedListeners = new Set<() => void>();

function setDbBlocked(value: boolean): void {
  if (dbBlocked === value) return;
  dbBlocked = value;
  for (const listener of [...blockedListeners]) listener();
}

export function isDbBlocked(): boolean {
  return dbBlocked;
}

export function onDbBlockedChange(listener: () => void): () => void {
  blockedListeners.add(listener);
  return () => blockedListeners.delete(listener);
}

function createLayout(db: IDBPDatabase<RssReaderDB>): void {
  db.createObjectStore('feeds', { keyPath: 'id' }).createIndex('by-url', 'url', { unique: false });
  const items = db.createObjectStore('items', { keyPath: 'id' });
  items.createIndex('by-feed-published', ['feedId', 'publishedAt']);
  items.createIndex('by-guid', 'guid');
  items.createIndex('by-published', 'publishedAt');
  createBodiesStore(db);
  const flags = db.createObjectStore('itemFlags', { keyPath: 'id' });
  flags.createIndex('by-read', 'read');
  flags.createIndex('by-starred', 'starred');
  flags.createIndex('by-feed-id', 'feedId');
  db.createObjectStore('meta', { keyPath: 'key' });
  db.createObjectStore('feedStats', { keyPath: 'feedId' });
  const markers = db.createObjectStore('readMarkers', { keyPath: 'id' });
  markers.createIndex('by-feed-id', 'feedId');
  markers.createIndex('by-acknowledged', 'acknowledged');
}

function createBodiesStore(db: IDBPDatabase<RssReaderDB>): void {
  db.createObjectStore('itemBodies', { keyPath: 'id' }).createIndex('by-feed-id', 'feedId');
}

async function moveBodiesOutOfItems(db: IDBPDatabase<RssReaderDB>, transaction: VersionChangeTransaction): Promise<void> {
  createBodiesStore(db);
  const bodies = transaction.objectStore('itemBodies');
  let cursor = await transaction.objectStore('items').openCursor();
  while (cursor) {
    const stored = cursor.value as StoredItemWithBodies;
    if ('html' in stored || 'extractedHtml' in stored) {
      const { html, extractedHtml, ...item } = stored;
      const body: ItemBody = { id: item.id, feedId: item.feedId };
      if (html) body.html = html;
      if (extractedHtml) body.extractedHtml = extractedHtml;
      if (body.html !== undefined || body.extractedHtml !== undefined) await bodies.put(body);
      await cursor.update(item);
    }
    cursor = await cursor.continue();
  }
}

/**
 * Versioned upgrade handler. Runs inside a versionchange transaction —
 * MUST use `transaction.objectStore(...)` (idb convenience methods open
 * their own transactions and throw while a versionchange is in flight).
 * Exported so tests can drive migrations from any old version.
 */
export async function upgradeDb<T extends DBSchema>(
  legacyDb: IDBPDatabase<T>,
  oldVersion: number,
  _newVersion: number | null,
  legacyTransaction: IDBPTransaction<T, StoreNames<T>[], 'versionchange'>,
): Promise<void> {
  const db = legacyDb as unknown as IDBPDatabase<RssReaderDB>;
  const transaction = legacyTransaction as unknown as VersionChangeTransaction;
  if (oldVersion === PREVIOUS_VERSION) {
    transaction.done.catch(() => {});
    try {
      await moveBodiesOutOfItems(db, transaction);
    } catch (error) {
      console.error('Database upgrade failed', error);
      try {
        transaction.abort();
      } catch {}
    }
    return;
  }
  for (const name of Array.from(db.objectStoreNames)) {
    db.deleteObjectStore(name);
  }
  createLayout(db);
}

export function releaseForUpgrade(db: Pick<IDBPDatabase<RssReaderDB>, 'close'>, reload: () => void): void {
  db.close();
  reload();
}

export function getDb(): Promise<IDBPDatabase<RssReaderDB>> {
  if (!dbPromise) {
    const opened: Promise<IDBPDatabase<RssReaderDB>> = openDB<RssReaderDB>(DB_NAME, DB_VERSION, {
      upgrade: upgradeDb,
      blocked: () => setDbBlocked(true),
      blocking: () => {
        void opened.then((db) => releaseForUpgrade(db, () => globalThis.location.reload()));
      },
    });
    dbPromise = opened;
    const settle = () => setDbBlocked(false);
    opened.then(settle, settle);
  }
  return dbPromise;
}
