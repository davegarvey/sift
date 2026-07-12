import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { getDb } from '../src/db/open';
import { upsertFeed, getFeedByUrl, listFeeds, deleteFeed } from '../src/db/feeds';
import {
  insertOrUpdateItem,
  getItem,
  listUnreadAcrossFeeds,
  listStarred,
  markRead,
  toggleStar,
  searchItems,
} from '../src/db/items';
import { runEviction } from '../src/articles/eviction';
import { getFlag } from '../src/db/flags';
import type { Feed, Item } from '../src/db/types';

function makeFeed(overrides: Partial<Feed> = {}): Feed {
  return {
    url: 'https://example.com/feed.xml',
    title: 'Test',
    learnedIntervalMs: 60 * 60 * 1000,
    lastFetched: null,
    ...overrides,
  };
}

function makeItem(overrides: Partial<Item> = {}): Item {
  const feedUrl = overrides.feedUrl ?? 'https://example.com/feed.xml';
  const guid = overrides.guid ?? 'guid-1';
  const publishedAt = overrides.publishedAt ?? Date.now();
  return {
    id: `${feedUrl}::${guid}`,
    feedUrl,
    guid,
    title: 'Item',
    excerpt: 'excerpt',
    publishedAt,
    updatedAt: publishedAt,
    read: false,
    starred: false,
    createdAt: Date.now(),
    ...overrides,
  };
}

describe('feeds store', () => {
  beforeEach(async () => {
    const db = await getDb();
    await db.clear('feeds');
    await db.clear('items');
    await db.clear('meta');
  });

  it('upserts and retrieves by URL', async () => {
    const feed = makeFeed();
    await upsertFeed(feed);
    const got = await getFeedByUrl(feed.url);
    expect(got?.title).toBe('Test');
  });

  it('lists all feeds', async () => {
    await upsertFeed(makeFeed({ url: 'a' }));
    await upsertFeed(makeFeed({ url: 'b' }));
    const list = await listFeeds();
    expect(list).toHaveLength(2);
  });

  it('deletes a feed', async () => {
    await upsertFeed(makeFeed());
    await deleteFeed(makeFeed().url);
    const got = await getFeedByUrl(makeFeed().url);
    expect(got).toBeUndefined();
  });
});

describe('items store', () => {
  beforeEach(async () => {
    const db = await getDb();
    await db.clear('feeds');
    await db.clear('items');
    await db.clear('itemFlags');
    await db.clear('meta');
  });

  it('inserts a new item', async () => {
    const item = makeItem();
    await insertOrUpdateItem(item);
    const got = await getItem(item.id);
    expect(got?.title).toBe('Item');
  });

  it('updates content by id but preserves user state', async () => {
    const item = makeItem({ read: false, starred: false });
    await insertOrUpdateItem(item);
    await markRead(item.id, true);
    await toggleStar(item.id);
    // An upstream refresh re-supplies the item with the same guid:
    await insertOrUpdateItem({ ...item, title: 'Updated', read: false, starred: false });
    const got = await getItem(item.id);
    expect(got?.title).toBe('Updated');
    expect(got?.read).toBe(true);
    expect(got?.starred).toBe(true);
  });

  it('synthesizes a composite id from feedUrl + guid (dedup via id identity)', async () => {
    const item = makeItem({ guid: 'no-guid-but-link' });
    await insertOrUpdateItem(item);
    // Same guid => same id => upserts in place.
    await insertOrUpdateItem({ ...item, title: 'Updated 2' });
    const got = await getItem(item.id);
    expect(got?.title).toBe('Updated 2');
  });

  it('lists unread items across feeds in reverse-chrono order', async () => {
    const feedUrl = 'https://example.com/feed.xml';
    await upsertFeed(makeFeed({ url: feedUrl }));
    await insertOrUpdateItem(makeItem({ guid: 'a', publishedAt: 1000 }));
    await insertOrUpdateItem(makeItem({ guid: 'b', publishedAt: 3000 }));
    await insertOrUpdateItem(makeItem({ guid: 'c', publishedAt: 2000, read: true }));
    const unread = await listUnreadAcrossFeeds();
    expect(unread.map((i) => i.guid)).toEqual(['b', 'a']);
  });

  it('lists starred items in reverse-chrono order', async () => {
    await insertOrUpdateItem(makeItem({ guid: 'a', publishedAt: 1000, starred: true }));
    await insertOrUpdateItem(makeItem({ guid: 'b', publishedAt: 3000, starred: true }));
    await insertOrUpdateItem(makeItem({ guid: 'c', publishedAt: 2000 }));
    const starred = await listStarred();
    expect(starred.map((i) => i.guid)).toEqual(['b', 'a']);
  });

  it('toggleStar flips the starred flag', async () => {
    const item = makeItem();
    await insertOrUpdateItem(item);
    await toggleStar(item.id);
    const got = await getItem(item.id);
    expect(got?.starred).toBe(true);
  });

  it('search finds items by title or excerpt (case-insensitive)', async () => {
    await insertOrUpdateItem(makeItem({ guid: '1', title: 'TypeScript News', excerpt: 'no match' }));
    await insertOrUpdateItem(makeItem({ guid: '2', title: 'boring', excerpt: 'Svelte 5 runes' }));
    const results = await searchItems('typescript');
    expect(results.map((r) => r.guid)).toEqual(['1']);
    const results2 = await searchItems('SVELTE');
    expect(results2.map((r) => r.guid)).toEqual(['2']);
  });

  it('insertOrUpdateItem creates a matching flag entry', async () => {
    const item = makeItem({ guid: 'a', read: false, starred: true });
    await insertOrUpdateItem(item);
    const flag = await getFlag(item.id);
    expect(flag?.id).toBe(item.id);
    expect(flag?.feedUrl).toBe(item.feedUrl);
    expect(flag?.read).toBe(0);
    expect(flag?.starred).toBe(1);
  });

  it('markRead updates both the item and the flag store', async () => {
    const item = makeItem({ guid: 'a', read: false });
    await insertOrUpdateItem(item);
    await markRead(item.id, true);
    const got = await getItem(item.id);
    expect(got?.read).toBe(true);
    const flag = await getFlag(item.id);
    expect(flag?.read).toBe(1);
  });

  it('toggleStar updates both the item and the flag store', async () => {
    const item = makeItem({ guid: 'a', starred: false });
    await insertOrUpdateItem(item);
    await toggleStar(item.id);
    const got = await getItem(item.id);
    expect(got?.starred).toBe(true);
    const flag = await getFlag(item.id);
    expect(flag?.starred).toBe(1);
  });

  it('searchItems respects AbortSignal — aborted search returns quickly', async () => {
    for (let i = 0; i < 20; i++) {
      await insertOrUpdateItem(makeItem({ guid: `s-${i}`, title: `Item ${i}`, excerpt: 'test' }));
    }
    const ac = new AbortController();
    ac.abort();
    const results = await searchItems('test', 50, ac.signal);
    expect(results).toEqual([]);
  });
});