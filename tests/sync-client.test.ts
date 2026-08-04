/**
 * Client-side sync tests: dirty queue + apply.
 */

import 'fake-indexeddb/auto';
import crypto from 'crypto';
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
    expect(parsed).toEqual({ feedId: 'https://example.com/feed.xml', guid: 'guid-1' });
  });

  it('round-trips a URL containing ::', () => {
    const id = encodeItemId('https://example.com/a::b/feed.xml', 'guid-1');
    const parsed = decodeItemId(id);
    expect(parsed?.feedId).toBe('https://example.com/a::b/feed.xml');
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
          feed_id: crypto.randomUUID(),
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
    const feedId = crypto.randomUUID();
    await upsertFeed({
      id: feedId,
      url: 'https://example.com/feed.xml',
      title: 'Example',
      learnedIntervalMs: 3_600_000,
      lastFetched: 100,
    });
    await applyRemoteState({
      serverTime: 2000,
      feeds: [
        {
          feed_id: feedId,
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

  it('applies a tombstone despite a newer lastFetched (fetch is not user authority)', async () => {
    const feedId = crypto.randomUUID();
    await upsertFeed({
      id: feedId,
      url: 'https://example.com/feed.xml',
      title: 'Example',
      learnedIntervalMs: 3_600_000,
      lastFetched: 1000,
    });
    await applyRemoteState({
      serverTime: 2000,
      feeds: [
        {
          feed_id: feedId,
          feed_url: 'https://example.com/feed.xml',
          row_at: 500,
          deleted: 1,
          deleted_at: 500,
        },
      ],
      flags: [],
    });
    const feeds = await listFeeds();
    expect(feeds.length).toBe(0);
  });

  it('keeps the local feed when the user touched it after the tombstone', async () => {
    const feedId = crypto.randomUUID();
    await upsertFeed({
      id: feedId,
      url: 'https://example.com/feed.xml',
      title: 'Example',
      modifiedAt: 1000,
      learnedIntervalMs: 3_600_000,
      lastFetched: 900,
    });
    await applyRemoteState({
      serverTime: 2000,
      feeds: [
        {
          feed_id: feedId,
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

  it('uses per-field timestamps as the legacy fallback when modifiedAt is absent', async () => {
    const feedId = crypto.randomUUID();
    await upsertFeed({
      id: feedId,
      url: 'https://example.com/feed.xml',
      title: 'Example',
      urlAt: 800,
      titleAt: 800,
      tagsAt: 800,
      learnedIntervalMs: 3_600_000,
      lastFetched: 900,
    });
    await applyRemoteState({
      serverTime: 2000,
      feeds: [
        {
          feed_id: feedId,
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

  it('keeps the local feed at equal timestamps (ties favor the local copy)', async () => {
    const feedId = crypto.randomUUID();
    await upsertFeed({
      id: feedId,
      url: 'https://example.com/feed.xml',
      title: 'Example',
      modifiedAt: 500,
      learnedIntervalMs: 3_600_000,
      lastFetched: 900,
    });
    await applyRemoteState({
      serverTime: 2000,
      feeds: [
        {
          feed_id: feedId,
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

  it('normalizes remote stamps to the local frame via the server offset (tombstone applies)', async () => {
    // Device clock is 3s fast: offset = serverTime - Date.now() = -3000.
    // Remote stamps are in the server frame; local stamps in the local frame.
    const feedId = crypto.randomUUID();
    await upsertFeed({
      id: feedId,
      url: 'https://example.com/feed.xml',
      title: 'Example',
      modifiedAt: 1000,
      learnedIntervalMs: 3_600_000,
      lastFetched: 900,
    });
    await applyRemoteState(
      {
        serverTime: 2000,
        feeds: [
          {
            feed_id: feedId,
            feed_url: 'https://example.com/feed.xml',
            row_at: 5000,
            deleted: 1,
            deleted_at: 5000,
          },
        ],
        flags: [],
      },
      -3000,
    );
    // deleted_at in the local frame = 5000 - (-3000) = 8000 > modifiedAt 1000.
    const feeds = await listFeeds();
    expect(feeds.length).toBe(0);
  });

  it('normalizes remote stamps to the local frame via the server offset (touch wins)', async () => {
    const feedId = crypto.randomUUID();
    await upsertFeed({
      id: feedId,
      url: 'https://example.com/feed.xml',
      title: 'Example',
      modifiedAt: 9000,
      learnedIntervalMs: 3_600_000,
      lastFetched: 900,
    });
    await applyRemoteState(
      {
        serverTime: 2000,
        feeds: [
          {
            feed_id: feedId,
            feed_url: 'https://example.com/feed.xml',
            row_at: 5000,
            deleted: 1,
            deleted_at: 5000,
          },
        ],
        flags: [],
      },
      -3000,
    );
    // deleted_at in the local frame = 8000 < modifiedAt 9000 → keep.
    const feeds = await listFeeds();
    expect(feeds.length).toBe(1);
  });

  it('stores merged per-field timestamps in the local frame', async () => {
    const feedId = crypto.randomUUID();
    await upsertFeed({
      id: feedId,
      url: 'https://example.com/feed.xml',
      title: 'Example',
      tags: ['old'],
      tagsAt: 100,
      learnedIntervalMs: 3_600_000,
      lastFetched: 900,
    });
    await applyRemoteState(
      {
        serverTime: 2000,
        feeds: [
          {
            feed_id: feedId,
            feed_url: 'https://example.com/feed.xml',
            tags: JSON.stringify(['new']),
            tags_at: 5000,
            row_at: 5000,
          },
        ],
        flags: [],
      },
      -3000,
    );
    const feed = await getFeedByUrl('https://example.com/feed.xml');
    expect(feed?.tags).toEqual(['new']);
    // tags_at stored in the local frame: 5000 - (-3000) = 8000.
    expect(feed?.tagsAt).toBe(8000);
  });

  it('applies a remote flag to an existing item', async () => {
    const feedId = crypto.randomUUID();
    await upsertFeed({
      id: feedId,
      url: 'https://example.com/feed.xml',
      title: 'Example',
      learnedIntervalMs: 3_600_000,
      lastFetched: 1000,
    });
    await insertOrUpdateItem({
      id: 'https://example.com/feed.xml::guid-1',
      feedId: 'https://example.com/feed.xml',
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
          feed_id: 'https://example.com/feed.xml',
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
    const feedId = crypto.randomUUID();
    await upsertFeed({
      id: feedId,
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
          feed_id: feedId,
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
    const feedId = crypto.randomUUID();
    await upsertFeed({
      id: feedId,
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
          feed_id: feedId,
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
    const feedId = crypto.randomUUID();
    await upsertFeed({
      id: feedId,
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
          feed_id: feedId,
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
          feed_id: 'https://example.com/feed.xml',
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
