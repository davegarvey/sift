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
import { subscribeFeed, unsubscribeFeed, updateFeedMeta } from '../src/feeds/service';

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
          feedId: expect.any(String),
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
          feedId: expect.any(String),
          folder: ['Tech', 'RSS'],
        }),
      );
  });

  it('sets modifiedAt on the local feed record', async () => {
    await subscribeFeed({ url: 'https://example.com/feed', title: 'Example' });
    const feeds = await listFeeds();
    expect(feeds[0].modifiedAt).toBeTypeOf('number');
  });
});

describe('updateFeedMeta', () => {
  it('bumps modifiedAt and omits the deleted stamp from the enqueue', async () => {
    await subscribeFeed({ url: 'https://example.com/feed', title: 'Example' });
    const feeds = await listFeeds();
    const before = feeds[0].modifiedAt;
    const { clearAllDirty } = await import('../src/sync/queue');
    clearAllDirty();
    await updateFeedMeta(feeds[0].id, { tags: ['rust'] });
    const dirty = getDirty();
    const entry = dirty.find((e) => e.kind === 'feed-upsert')!;
    expect(entry.kind === 'feed-upsert' && entry.deleted).toBeNull();
    const after = (await listFeeds())[0].modifiedAt;
    expect(after).toBeGreaterThanOrEqual(before!);
  });
});

describe('unsubscribeFeed', () => {
  it('removes the feed from local IndexedDB', async () => {
    await subscribeFeed({ url: 'https://example.com/feed', title: 'Example' });
    const feeds = await listFeeds();
    await unsubscribeFeed(feeds[0].id);
    const feedsAfter = await listFeeds();
    expect(feedsAfter.length).toBe(0);
  });

  it('enqueues a feed-delete entry carrying the feed URL', async () => {
    await subscribeFeed({ url: 'https://example.com/feed', title: 'Example' });
    const feeds = await listFeeds();
    const feedId = feeds[0].id;
    const { clearAllDirty } = await import('../src/sync/queue');
    clearAllDirty();
    await unsubscribeFeed(feedId);
    const dirty = getDirty();
      expect(dirty).toContainEqual(
        expect.objectContaining({
          kind: 'feed-delete',
          feedId,
          feedUrl: { value: 'https://example.com/feed', at: expect.any(Number) },
        }),
      );
  });

  it('drops pending feed-upserts for the same feed when deleting', async () => {
    await subscribeFeed({ url: 'https://example.com/feed', title: 'Example' });
    const feeds = await listFeeds();
    await updateFeedMeta(feeds[0].id, { tags: ['rust'] });
    await unsubscribeFeed(feeds[0].id);
    const dirty = getDirty();
    const upserts = dirty.filter((e) => e.kind === 'feed-upsert' && e.feedId === feeds[0].id);
    expect(upserts.length).toBe(0);
    expect(dirty).toContainEqual(expect.objectContaining({ kind: 'feed-delete', feedId: feeds[0].id }));
  });
});
