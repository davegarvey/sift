/**
 * Regression tests for the feed subscription service.
 *
 * These tests guard against the class of bug where feed mutations (UI
 * subscribe, UI unsubscribe, OPML import) were written to local IndexedDB
 * but never enqueued for sync, leaving the server's `feeds` table empty.
 */

import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach } from 'vitest';
import { getDb } from '../src/db/open';
import { listFeeds } from '../src/db/feeds';
import { getDirty } from '../src/sync/queue';
import { subscribeFeed, unsubscribeFeed } from '../src/feeds/service';

beforeEach(async () => {
  const db = await getDb();
  await db.clear('feeds');
  await db.clear('meta');
  const { clearAllDirty } = await import('../src/sync/queue');
  clearAllDirty();
});

describe('subscribeFeed', () => {
  it('writes the feed to local IndexedDB', async () => {
    await subscribeFeed({ url: 'https://example.com/feed', title: 'Example' });
    const feeds = await listFeeds();
    expect(feeds.length).toBe(1);
    expect(feeds[0].url).toBe('https://example.com/feed');
    expect(feeds[0].title).toBe('Example');
    expect(feeds[0].lastFetched).toBeNull();
  });

  it('enqueues a feed-upsert entry in the sync dirty queue', async () => {
    await subscribeFeed({ url: 'https://example.com/feed', title: 'Example' });
    const dirty = getDirty();
    expect(dirty).toContainEqual(
      expect.objectContaining({
        kind: 'feed-upsert',
        feedUrl: 'https://example.com/feed',
        title: 'Example',
        folder: null,
        deleted: 0,
      }),
    );
  });

  it('includes folder in the enqueue when provided', async () => {
    await subscribeFeed({
      url: 'https://example.com/feed',
      title: 'Example',
      folder: ['Tech', 'RSS'],
    });
    const dirty = getDirty();
    expect(dirty).toContainEqual(
      expect.objectContaining({
        kind: 'feed-upsert',
        feedUrl: 'https://example.com/feed',
        folder: ['Tech', 'RSS'],
      }),
    );
  });
});

describe('unsubscribeFeed', () => {
  it('removes the feed from local IndexedDB', async () => {
    await subscribeFeed({ url: 'https://example.com/feed', title: 'Example' });
    await unsubscribeFeed('https://example.com/feed');
    const feeds = await listFeeds();
    expect(feeds.length).toBe(0);
  });

  it('enqueues a feed-delete entry in the sync dirty queue', async () => {
    await subscribeFeed({ url: 'https://example.com/feed', title: 'Example' });
    const { clearAllDirty } = await import('../src/sync/queue');
    clearAllDirty();
    await unsubscribeFeed('https://example.com/feed');
    const dirty = getDirty();
    expect(dirty).toContainEqual(
      expect.objectContaining({
        kind: 'feed-delete',
        feedUrl: 'https://example.com/feed',
      }),
    );
  });
});
