/**
 * Client-side sync tests: dirty queue + apply.
 */

import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach } from 'vitest';
import { getDb } from '../src/db/open';
import { upsertFeed, listFeeds, getFeedByUrl } from '../src/db/feeds';
import { insertOrUpdateItem, listItems } from '../src/db/items';
import { applyRemoteState } from '../src/sync/apply';
import { encodeItemId, decodeItemId } from '../src/sync/itemId';

beforeEach(async () => {
  const db = await getDb();
  await db.clear('feeds');
  await db.clear('items');
  await db.clear('itemFlags');
  await db.clear('meta');
});

describe('item ID encoding', () => {
  it('round-trips a simple URL', () => {
    const id = encodeItemId('https://example.com/feed.xml', 'guid-1');
    expect(id).toBe('https%3A%2F%2Fexample.com%2Ffeed.xml::guid-1');
    const parsed = decodeItemId(id);
    expect(parsed).toEqual({ feedUrl: 'https://example.com/feed.xml', guid: 'guid-1' });
  });

  it('round-trips a URL containing ::', () => {
    const id = encodeItemId('https://example.com/a::b/feed.xml', 'guid-1');
    const parsed = decodeItemId(id);
    expect(parsed?.feedUrl).toBe('https://example.com/a::b/feed.xml');
    expect(parsed?.guid).toBe('guid-1');
  });

  it('returns null for malformed input', () => {
    expect(decodeItemId('no-separator')).toBe(null);
  });
});

describe('applyRemoteState', () => {
  it('applies a new feed', async () => {
    await applyRemoteState({
      serverTime: 1000,
      feeds: [
        {
          feed_url: 'https://example.com/feed.xml',
          folder: '["Tech"]',
          folder_at: 500,
          title: 'Example',
          title_at: 500,
          row_at: 500,
        },
      ],
      flags: [],
    });
    const feeds = await listFeeds();
    expect(feeds.length).toBe(1);
    expect(feeds[0].title).toBe('Example');
    expect(feeds[0].folder).toEqual(['Tech']);
  });

  it('unsubscribes a tombstoned feed when remote is newer', async () => {
    await upsertFeed({
      url: 'https://example.com/feed.xml',
      title: 'Example',
      learnedIntervalMs: 3_600_000,
      lastFetched: 100,
    });
    await applyRemoteState({
      serverTime: 2000,
      feeds: [
        {
          feed_url: 'https://example.com/feed.xml',
          row_at: 2000,
          deleted: 1,
          deleted_at: 1500,
        },
      ],
      flags: [],
    });
    const feeds = await listFeeds();
    expect(feeds.length).toBe(0);
  });

  it('preserves local feed when tombstone is older', async () => {
    await upsertFeed({
      url: 'https://example.com/feed.xml',
      title: 'Example',
      learnedIntervalMs: 3_600_000,
      lastFetched: 1000,
    });
    await applyRemoteState({
      serverTime: 2000,
      feeds: [
        {
          feed_url: 'https://example.com/feed.xml',
          row_at: 500,
          deleted: 1,
          deleted_at: 500,
        },
      ],
      flags: [],
    });
    const feeds = await listFeeds();
    expect(feeds.length).toBe(1);
  });

  it('applies a remote flag to an existing item', async () => {
    await upsertFeed({
      url: 'https://example.com/feed.xml',
      title: 'Example',
      learnedIntervalMs: 3_600_000,
      lastFetched: 1000,
    });
    await insertOrUpdateItem({
      id: 'https://example.com/feed.xml::guid-1',
      feedUrl: 'https://example.com/feed.xml',
      guid: 'guid-1',
      title: 'Hello',
      publishedAt: 100,
      updatedAt: 100,
      excerpt: '...',
      read: false,
      starred: false,
      createdAt: 100,
    });
    const itemId = encodeItemId('https://example.com/feed.xml', 'guid-1');
    await applyRemoteState({
      serverTime: 2000,
      feeds: [],
      flags: [
        {
          item_id: itemId,
          feed_url: 'https://example.com/feed.xml',
          read: 1,
          read_at: 1500,
          starred: 1,
          starred_at: 1500,
          row_at: 1500,
        },
      ],
    });
    const items = await listItems(10);
    expect(items.length).toBe(1);
    expect(items[0].read).toBe(true);
    expect(items[0].starred).toBe(true);
  });

  it('applies remote tags when newer than local', async () => {
    await upsertFeed({
      url: 'https://example.com/feed.xml',
      title: 'Example',
      tags: ['old'],
      tagsAt: 100,
      learnedIntervalMs: 3_600_000,
      lastFetched: 1000,
    });
    await applyRemoteState({
      serverTime: 2000,
      feeds: [
        {
          feed_url: 'https://example.com/feed.xml',
          tags: JSON.stringify(['rust', 'dev']),
          tags_at: 500,
          row_at: 500,
        },
      ],
      flags: [],
    });
    const feed = await getFeedByUrl('https://example.com/feed.xml');
    expect(feed?.tags).toEqual(['rust', 'dev']);
  });

  it('preserves local tags when remote is older', async () => {
    await upsertFeed({
      url: 'https://example.com/feed.xml',
      title: 'Example',
      tags: ['rust'],
      tagsAt: 1000,
      learnedIntervalMs: 3_600_000,
      lastFetched: 500,
    });
    await applyRemoteState({
      serverTime: 2000,
      feeds: [
        {
          feed_url: 'https://example.com/feed.xml',
          tags: JSON.stringify(['old']),
          tags_at: 500,
          row_at: 500,
        },
      ],
      flags: [],
    });
    const feed = await getFeedByUrl('https://example.com/feed.xml');
    expect(feed?.tags).toEqual(['rust']);
  });

  it('does not clear local tags when remote has null tags', async () => {
    await upsertFeed({
      url: 'https://example.com/feed.xml',
      title: 'Example',
      tags: ['rust'],
      tagsAt: 100,
      learnedIntervalMs: 3_600_000,
      lastFetched: 1000,
    });
    await applyRemoteState({
      serverTime: 2000,
      feeds: [
        {
          feed_url: 'https://example.com/feed.xml',
          tags: null,
          tags_at: null,
          row_at: 500,
        },
      ],
      flags: [],
    });
    const feed = await getFeedByUrl('https://example.com/feed.xml');
    expect(feed?.tags).toEqual(['rust']);
  });

  it('stores a remote flag for an unknown item', async () => {
    const itemId = encodeItemId('https://example.com/feed.xml', 'guid-unknown');
    await applyRemoteState({
      serverTime: 2000,
      feeds: [],
      flags: [
        {
          item_id: itemId,
          feed_url: 'https://example.com/feed.xml',
          read: 1,
          read_at: 1500,
          starred: 0,
          starred_at: 1500,
          row_at: 1500,
        },
      ],
    });
    // The item doesn't exist, so the flag is stored in itemFlags.
    // The apply function should not throw.
    const items = await listItems(10);
    expect(items.length).toBe(0);
  });
});
