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
import { getDirty, enqueueFlag } from '../src/sync/queue';
import { setStoredServerOffset } from '../src/sync/key';
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

describe('server-clock offset on push', () => {
  beforeEach(async () => {
    const { setStoredSyncKey } = await import('../src/sync/key');
    await setStoredSyncKey('a'.repeat(22));
  });

  it('converts outgoing stamps to the server frame', async () => {
    const { flushNow } = await import('../src/sync/push');
    await setStoredServerOffset(5000);
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
    expect((flag?.read as { at: number }).at).toBe(6000);
    expect((flag?.starred as { at: number }).at).toBe(7000);
    expect(getDirty().length).toBe(0);
  });

  it('uses the local stamp unchanged when no offset is stored', async () => {
    const { flushNow } = await import('../src/sync/push');
    await setStoredServerOffset(null);
    const itemId = 'feed-id::guid-2';
    enqueueFlag({
      itemId,
      feedId: 'feed-id',
      read: 1,
      readAt: 1000,
      starred: 0,
      starredAt: 1000,
    });
    let captured: { flags?: Array<Record<string, unknown>> } = {};
    globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
      captured = JSON.parse(String(init?.body));
      return new Response(null, { status: 204 });
    }) as unknown as typeof globalThis.fetch;
    await flushNow();
    const flag = captured.flags?.[0];
    expect((flag?.read as { at: number }).at).toBe(1000);
  });
});
