import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach } from 'vitest';
import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import { getDb, upgradeDb } from '../src/db/open';
import { parseFeed, parsedToItems } from '../src/feeds/parse';
import { insertOrUpdateItem, bulkUpsertItems, getItem, listUnreadAcrossFeeds, listStarred } from '../src/db/items';
import { relativeTime, humanRelativeTime } from '../src/util/time';
import { DB_NAME, DB_VERSION, type Feed, type FeedStats, type Item, type Meta, type ReadMarker } from '../src/db/types';
import type { ItemFlag } from '../src/db/flags';

const NOW = Date.now();
const FIRST_SEEN = NOW - 100_000;
const REFRESH = NOW - 1_000;
const FUTURE = NOW + 86_400_000;
const PAST = NOW - 86_400_000;

function makeItem(overrides: Partial<Item> = {}): Item {
  const feedId = overrides.feedId ?? 'f1';
  const guid = overrides.guid ?? 'g1';
  const publishedAt = overrides.publishedAt ?? PAST;
  return {
    id: `${feedId}::${guid}`,
    feedId,
    guid,
    title: 'Item',
    excerpt: 'excerpt',
    publishedAt,
    updatedAt: publishedAt,
    read: false,
    starred: false,
    createdAt: FIRST_SEEN,
    ...overrides,
  } as Item;
}

const RSS = (items: string) => `<?xml version="1.0"?>
<rss version="2.0"><channel><title>X</title><link>https://x.com</link>${items}</channel></rss>`;

const itemXml = (guid: string, pubDate: string | null) =>
  `<item><title>T ${guid}</title><guid>${guid}</guid><link>https://x.com/${guid}</link>` +
  (pubDate ? `<pubDate>${pubDate}</pubDate>` : '') +
  `<description>d</description></item>`;

describe('parse: publish date fallback', () => {
  it('uses a valid past feed date without flagging', () => {
    const parsed = parseFeed(RSS(itemXml('a', 'Mon, 01 Jan 2024 00:00:00 GMT')))!;
    const [item] = parsedToItems(parsed, 'f1');
    expect(item.publishedAt).toBe(Date.parse('Mon, 01 Jan 2024 00:00:00 GMT'));
    expect(item.dateFallback).toBeUndefined();
  });

  it('falls back to createdAt when the date is missing', () => {
    const parsed = parseFeed(RSS(itemXml('b', null)))!;
    const [item] = parsedToItems(parsed, 'f1');
    expect(item.publishedAt).toBe(item.createdAt);
    expect(item.dateFallback).toBe(true);
  });

  it('falls back to createdAt when the date is unparseable', () => {
    const parsed = parseFeed(RSS(itemXml('c', 'not a date')))!;
    const [item] = parsedToItems(parsed, 'f1');
    expect(item.publishedAt).toBe(item.createdAt);
    expect(item.dateFallback).toBe(true);
  });

  it('falls back to createdAt when the date is in the future', () => {
    const parsed = parseFeed(RSS(itemXml('d', 'Thu, 01 Jan 2030 00:00:00 GMT')))!;
    const [item] = parsedToItems(parsed, 'f1');
    expect(item.publishedAt).toBe(item.createdAt);
    expect(item.dateFallback).toBe(true);
  });
});

describe('merge: dates are never re-stamped', () => {
  beforeEach(async () => {
    const db = await getDb();
    await db.clear('feeds');
    await db.clear('items');
    await db.clear('itemFlags');
    await db.clear('meta');
  });

  it('keeps first-seen publishedAt/createdAt/updatedAt and the flag across a fallback refresh', async () => {
    await insertOrUpdateItem(makeItem({ publishedAt: FIRST_SEEN, updatedAt: FIRST_SEEN, createdAt: FIRST_SEEN, dateFallback: true }));
    await insertOrUpdateItem(makeItem({ publishedAt: REFRESH, updatedAt: REFRESH, createdAt: REFRESH, dateFallback: true }));
    const stored = await getItem('f1::g1');
    expect(stored?.publishedAt).toBe(FIRST_SEEN);
    expect(stored?.createdAt).toBe(FIRST_SEEN);
    expect(stored?.updatedAt).toBe(FIRST_SEEN);
    expect(stored?.dateFallback).toBe(true);
  });

  it('keeps an existing real date when the refresh has no date, without setting the flag', async () => {
    await insertOrUpdateItem(makeItem({ publishedAt: PAST, updatedAt: PAST }));
    await insertOrUpdateItem(makeItem({ publishedAt: REFRESH, updatedAt: REFRESH, createdAt: REFRESH, dateFallback: true }));
    const stored = await getItem('f1::g1');
    expect(stored?.publishedAt).toBe(PAST);
    expect(stored?.dateFallback).toBeUndefined();
  });

  it('takes a real incoming date and clears the fallback flag', async () => {
    await insertOrUpdateItem(makeItem({ publishedAt: FIRST_SEEN, updatedAt: FIRST_SEEN, createdAt: FIRST_SEEN, dateFallback: true }));
    await insertOrUpdateItem(makeItem({ publishedAt: PAST, updatedAt: PAST }));
    const stored = await getItem('f1::g1');
    expect(stored?.publishedAt).toBe(PAST);
    expect(stored?.dateFallback).toBeUndefined();
  });

  it('replaces an existing future date with the fallback when refreshed', async () => {
    await insertOrUpdateItem(makeItem({ publishedAt: FUTURE, updatedAt: FUTURE }));
    await insertOrUpdateItem(makeItem({ publishedAt: REFRESH, updatedAt: REFRESH, createdAt: REFRESH, dateFallback: true }));
    const stored = await getItem('f1::g1');
    expect(stored?.publishedAt).toBe(REFRESH);
    expect(stored?.dateFallback).toBe(true);
  });

  it('applies the same rules through bulkUpsertItems', async () => {
    await insertOrUpdateItem(makeItem({ publishedAt: FIRST_SEEN, updatedAt: FIRST_SEEN, createdAt: FIRST_SEEN, dateFallback: true }));
    await bulkUpsertItems([makeItem({ publishedAt: REFRESH, updatedAt: REFRESH, createdAt: REFRESH, dateFallback: true })]);
    const stored = await getItem('f1::g1');
    expect(stored?.publishedAt).toBe(FIRST_SEEN);
    expect(stored?.createdAt).toBe(FIRST_SEEN);
    expect(stored?.dateFallback).toBe(true);
  });
});

describe('migration v9', () => {
  // Structurally identical to open.ts's RssReaderDB so `upgradeDb` is
  // directly assignable as the upgrade callback for the seeded database.
  interface SeedSchema extends DBSchema {
    feeds: { key: string; value: Feed; indexes: { 'by-url': string } };
    items: { key: string; value: Item; indexes: { 'by-feed-published': [string, number]; 'by-guid': string; 'by-published': number } };
    itemFlags: { key: string; value: ItemFlag; indexes: { 'by-read': number; 'by-starred': number; 'by-feed-id': string } };
    meta: { key: string; value: Meta };
    feedStats: { key: string; value: FeedStats; indexes: {} };
    readMarkers: { key: string; value: ReadMarker; indexes: { 'by-feed-id': string; 'by-acknowledged': number } };
  }

  const seedUpgrade = (version: number) => (db: IDBPDatabase<SeedSchema>) => {
    const feeds = db.createObjectStore('feeds', { keyPath: 'id' });
    if (version >= 6) feeds.createIndex('by-url', 'url');
    const items = db.createObjectStore('items', { keyPath: 'id' });
    items.createIndex('by-feed-published', ['feedId', 'publishedAt']);
    items.createIndex('by-guid', 'guid');
    items.createIndex('by-published', 'publishedAt');
    const flags = db.createObjectStore('itemFlags', { keyPath: 'id' });
    flags.createIndex('by-read', 'read');
    flags.createIndex('by-starred', 'starred');
    flags.createIndex('by-feed-id', 'feedId');
    db.createObjectStore('meta', { keyPath: 'key' });
  };

  async function seed(version: number, name: string): Promise<void> {
    const db = await openDB<SeedSchema>(name, version, { upgrade: seedUpgrade(version) });
    const feed: Feed = {
      id: 'f1',
      url: 'https://x.com/feed.xml',
      title: 'X',
      learnedIntervalMs: 60 * 60 * 1000,
      lastFetched: null,
    };
    await db.put('feeds', feed);
    await db.put('items', makeItem({ guid: 'future', publishedAt: FUTURE, updatedAt: FUTURE, createdAt: FIRST_SEEN }));
    await db.put('items', { ...makeItem({ guid: 'flagless' }), dateFallback: undefined });
    await db.put('items', makeItem({ guid: 'valid', publishedAt: PAST, updatedAt: PAST, dateFallback: undefined }));
    await db.put('items', makeItem({ guid: 'opened', firstOpenedAt: FIRST_SEEN }));
    const noCreatedAt = makeItem({ guid: 'nocreated', publishedAt: FUTURE, updatedAt: FUTURE });
    delete (noCreatedAt as Partial<Item>).createdAt;
    await db.put('items', noCreatedAt);
    await db.put('itemFlags', { id: 'f1::valid', feedId: 'f1', read: 1, starred: 0 });
    await db.put('meta', { key: 'flagsBackfilled', value: true });
    await db.put('meta', {
      key: 'settings',
      value: { syncKey: 'a'.repeat(22), lastSyncAt: 123, lastStatsSyncAt: 456, serverOffset: 789 },
    });
    db.close();
  }

  it('repairs future dates, backfills flags, leaves valid items, drops the meta key', async () => {
    const name = `${DB_NAME}-mig-repair`;
    await seed(6, name);
    const db = await openDB<SeedSchema>(name, DB_VERSION, { upgrade: upgradeDb });

    const future = (await db.get('items', 'f1::future'))!;
    expect(future.publishedAt).toBe(FIRST_SEEN);
    expect(future.publishedAt).toBeLessThanOrEqual(Date.now());
    expect(future.dateFallback).toBe(true);

    const nocreated = (await db.get('items', 'f1::nocreated'))!;
    expect(Number.isFinite(nocreated.publishedAt)).toBe(true);
    expect(nocreated.publishedAt).toBeLessThanOrEqual(Date.now());
    expect(nocreated.dateFallback).toBe(true);

    const valid = (await db.get('items', 'f1::valid'))!;
    expect(valid.publishedAt).toBe(PAST);
    expect(valid.dateFallback).toBeUndefined();

    const backfilled = (await db.get('itemFlags', 'f1::flagless'))!;
    expect(backfilled.read).toBe(0);
    expect(backfilled.starred).toBe(0);

    expect(await db.get('meta', 'flagsBackfilled')).toBeUndefined();
    const stats = await db.get('feedStats', 'f1');
    expect(stats?.totalSeen).toBe(5);
    expect(stats?.readOnce).toBe(2);
    expect(await db.get('readMarkers', 'f1::valid')).toMatchObject({ acknowledged: 0 });
    expect(await db.get('readMarkers', 'f1::opened')).toMatchObject({ acknowledged: 0 });
    expect(await db.get('meta', 'settings')).toMatchObject({
      value: { lastSyncAt: null, lastStatsSyncAt: null, serverOffset: null },
    });
    db.close();
  });

  it('upgrades a v5 database through the full chain to v9', async () => {
    const name = `${DB_NAME}-mig-v5`;
    await seed(5, name);
    const db = await openDB<SeedSchema>(name, DB_VERSION, { upgrade: upgradeDb });
    expect(db.objectStoreNames.contains('items')).toBe(true);
    const tx = db.transaction('feeds', 'readonly');
    expect(tx.store.indexNames.contains('by-url')).toBe(true);
    const future = (await db.get('items', 'f1::future'))!;
    expect(future.publishedAt).toBe(FIRST_SEEN);
    expect(future.dateFallback).toBe(true);
    expect(db.objectStoreNames.contains('feedStats')).toBe(true);
    expect(db.objectStoreNames.contains('readMarkers')).toBe(true);
    db.close();
  });

  it('fresh install at v9 runs the whole chain cleanly', async () => {
    const name = `${DB_NAME}-mig-fresh`;
    const db = await openDB<SeedSchema>(name, DB_VERSION, { upgrade: upgradeDb });
    expect(db.objectStoreNames.contains('feeds')).toBe(true);
    expect(db.objectStoreNames.contains('items')).toBe(true);
    expect(db.objectStoreNames.contains('itemFlags')).toBe(true);
    expect(db.objectStoreNames.contains('meta')).toBe(true);
    expect(db.objectStoreNames.contains('feedStats')).toBe(true);
    expect(db.objectStoreNames.contains('readMarkers')).toBe(true);
    db.close();
  });
});

describe('listings without the meta flag', () => {
  beforeEach(async () => {
    const db = await getDb();
    await db.clear('feeds');
    await db.clear('items');
    await db.clear('itemFlags');
    await db.clear('meta');
    await db.clear('feedStats');
    await db.clear('readMarkers');
  });

  it('listUnreadAcrossFeeds and listStarred use the flags store', async () => {
    await insertOrUpdateItem(makeItem({ guid: 'unread' }));
    await insertOrUpdateItem(makeItem({ guid: 'read', read: true }));
    await insertOrUpdateItem(makeItem({ guid: 'starred', starred: true }));
    const unread = await listUnreadAcrossFeeds();
    expect(unread.map((i) => i.guid)).toEqual(['unread', 'starred']);
    const starred = await listStarred();
    expect(starred.map((i) => i.guid)).toEqual(['starred']);
  });
});

describe('display guards', () => {
  it('relativeTime reports unknown for non-positive and future timestamps', () => {
    expect(relativeTime(0)).toBe('unknown');
    expect(relativeTime(-1)).toBe('unknown');
    expect(relativeTime(Date.now() + 3_600_000)).toBe('unknown');
    expect(relativeTime(Date.now() - 5_000)).toBe('just now');
  });

  it('humanRelativeTime reports unknown for non-positive and future timestamps', () => {
    expect(humanRelativeTime(new Date(0))).toBe('unknown');
    expect(humanRelativeTime(new Date(Date.now() + 3_600_000))).toBe('unknown');
    expect(humanRelativeTime(new Date(Date.now() - 5_000))).toBe('just now');
  });
});
