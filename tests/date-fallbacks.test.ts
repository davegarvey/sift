import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach } from 'vitest';
import { getDb } from '../src/db/open';
import { parseFeed, parsedToItems } from '../src/feeds/parse';
import { insertOrUpdateItem, bulkUpsertItems, getItem, listUnreadAcrossFeeds, listStarred } from '../src/db/items';
import { relativeTime, humanRelativeTime } from '../src/util/time';
import type { Item } from '../src/db/types';

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
