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
import { getDirty, enqueueFeed, enqueueFeedDelete, enqueueFlag, enqueueReadMarker, enqueueStats, rekeyDirtyFeedId } from '../src/sync/queue';
import { subscribeFeed, unsubscribeFeed, updateFeedMeta } from '../src/feeds/service';

beforeEach(async () => {
  const db = await getDb();
  await db.clear('feeds');
  await db.clear('feedStats');
  await db.clear('readMarkers');
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

describe('feed identity rekeying', () => {
  it('rewrites every pending feed-linked entry', () => {
    const oldFeedId = 'local-feed';
    const newFeedId = 'server-feed';
    enqueueFeed({
      feedId: oldFeedId,
      folder: null,
      folderAt: 1,
      title: 'Feed',
      titleAt: 1,
      feedUrl: { value: 'https://example.com/feed', at: 1 },
      htmlUrl: null,
      tags: null,
      tagsAt: 1,
      deleted: 0,
      deletedAt: null,
    });
    enqueueFeedDelete(oldFeedId, { value: 'https://example.com/feed', at: 2 }, 2);
    enqueueFlag({
      itemId: `${oldFeedId}::article`,
      feedId: oldFeedId,
      read: 1,
      readAt: 3,
      starred: 0,
      starredAt: 3,
    });
    enqueueStats({ feedId: oldFeedId, totalSeen: 1, at: 4 });
    enqueueReadMarker({ itemId: `${oldFeedId}::article`, feedId: oldFeedId, at: 5 });

    rekeyDirtyFeedId(oldFeedId, newFeedId);

    expect(getDirty()).toEqual([
      expect.objectContaining({ kind: 'feed-delete', feedId: newFeedId }),
      expect.objectContaining({ kind: 'flag-update', feedId: newFeedId, itemId: `${newFeedId}::article` }),
      expect.objectContaining({ kind: 'stats-update', feedId: newFeedId }),
      expect.objectContaining({ kind: 'read-marker', feedId: newFeedId, itemId: `${newFeedId}::article` }),
    ]);
    expect(getDirty().some((entry) => entry.feedId === oldFeedId)).toBe(false);
  });
});

describe('push payload contract', () => {
  beforeEach(async () => {
    const { setStoredSyncKey } = await import('../src/sync/key');
    await setStoredSyncKey('a'.repeat(22));
  });

  it('sends bare flag values with no timestamps', async () => {
    const { flushNow } = await import('../src/sync/push');
    const itemId = 'feed-id::guid-1';
    enqueueFlag({
      itemId,
      feedId: 'feed-id',
      read: 1,
      readAt: 1000,
      starred: 0,
      starredAt: 2000,
    });
    let captured: { flags?: Array<Record<string, unknown>> } = {};
    globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
      captured = JSON.parse(String(init?.body));
      return new Response(null, { status: 204 });
    }) as unknown as typeof globalThis.fetch;
    await flushNow();
    const flag = captured.flags?.[0];
    expect(flag).toEqual({ itemId, feedId: 'feed-id', read: 1, starred: 0 });
    expect(JSON.stringify(captured)).not.toContain('"at"');
    expect(getDirty().length).toBe(0);
  });

  it('sends bare feed values with no timestamps', async () => {
    const { flushNow } = await import('../src/sync/push');
    const { clearAllDirty } = await import('../src/sync/queue');
    await subscribeFeed({ url: 'https://example.com/feed', title: 'Example' });
    clearAllDirty();
    await subscribeFeed({ url: 'https://example.com/feed', title: 'Example' });
    const dirty = getDirty();
    const entry = dirty.find((e) => e.kind === 'feed-upsert')!;
    const feedId = entry.feedId;
    clearAllDirty();
    enqueueFeed({
      feedId,
      feedUrl: { value: 'https://example.com/feed', at: 1000 },
      title: 'Example',
      titleAt: 1000,
      folder: null,
      folderAt: 0,
      htmlUrl: null,
      tags: null,
      tagsAt: 0,
      deleted: 0,
      deletedAt: null,
    });
    let captured: { feeds?: Array<Record<string, unknown>> } = {};
    globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
      captured = JSON.parse(String(init?.body));
      return new Response(null, { status: 204 });
    }) as unknown as typeof globalThis.fetch;
    await flushNow();
    const feed = captured.feeds?.[0];
    expect(feed).toEqual({
      feedId,
      feedUrl: 'https://example.com/feed',
      title: 'Example',
      deleted: 0,
    });
    expect(JSON.stringify(captured)).not.toContain('"at"');
  });

  it('sends statistics through the separate endpoint and acknowledges markers', async () => {
    const { flushNow } = await import('../src/sync/push');
    const { resetSyncCapabilityCache } = await import('../src/sync/capabilities');
    const db = await getDb();
    resetSyncCapabilityCache();
    await db.put('readMarkers', { id: 'stats-feed::article-1', feedId: 'stats-feed', acknowledged: 0 });
    enqueueStats({ feedId: 'stats-feed', totalSeen: 4, feedUrl: 'https://example.com/stats', title: 'Stats' });
    enqueueReadMarker({ itemId: 'stats-feed::article-1', feedId: 'stats-feed' });
    let capturedUrl = '';
    let captured: Record<string, unknown> = {};
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      capturedUrl = String(input);
      if (capturedUrl.endsWith('/sync/capabilities')) return new Response(JSON.stringify({ sync: true, stats: true }), { status: 200 });
      captured = JSON.parse(String(init?.body));
      return new Response(JSON.stringify({
        acknowledged: ['stats-feed::article-1'],
        stats: [{ feed_id: 'stats-feed', total_seen: 4, read_once: 1 }],
      }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }) as unknown as typeof globalThis.fetch;
    await flushNow();
    expect(capturedUrl).toContain('/sync/stats/push');
    expect(captured.stats).toEqual([{ feedId: 'stats-feed', totalSeen: 4, feedUrl: 'https://example.com/stats', title: 'Stats' }]);
    expect(captured.markers).toEqual([{ itemId: `${encodeURIComponent('stats-feed')}::article-1`, feedId: 'stats-feed' }]);
    expect(getDirty().filter((entry) => entry.kind === 'read-marker')).toHaveLength(0);
    expect((await db.get('readMarkers', 'stats-feed::article-1'))?.acknowledged).toBe(1);
  });

  it('does not contact the network for local-only statistics', async () => {
    const { flushNow } = await import('../src/sync/push');
    const { setMeta } = await import('../src/db/meta');
    const { resetSyncCapabilityCache } = await import('../src/sync/capabilities');
    resetSyncCapabilityCache();
    await setMeta('settings', { syncKey: null });
    enqueueStats({ feedId: 'local-feed', totalSeen: 7 });
    let calls = 0;
    globalThis.fetch = (async () => {
      calls += 1;
      throw new Error('network should not be used');
    }) as unknown as typeof globalThis.fetch;
    await flushNow();
    expect(calls).toBe(0);
    expect(getDirty()).toContainEqual(expect.objectContaining({ kind: 'stats-update', feedId: 'local-feed' }));
  });
});
