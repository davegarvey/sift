/**
 * Feed scheduler tests: background fetches must never touch user-authority
 * fields (modifiedAt, urlAt) — only user-initiated mutations may.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

// The scheduler transitively imports util/idle, which registers event
// listeners on `document` at module load. Node has none, so stub the
// browser globals before the dynamic import below.
vi.stubGlobal('document', {
  addEventListener: () => {},
  visibilityState: 'visible',
});
vi.stubGlobal('window', { addEventListener: () => {} });

import 'fake-indexeddb/auto';
import { getDb } from '../src/db/open';
import { upsertFeed, getFeed } from '../src/db/feeds';

beforeEach(async () => {
  const db = await getDb();
  await db.clear('feeds');
  await db.clear('items');
  await db.clear('itemFlags');
});

const RSS = `<rss version="2.0"><channel><title>X</title><link>https://x.example</link><description>d</description></channel></rss>`;

function stubFetch(status: number, body: string): void {
  globalThis.fetch = (async () =>
    new Response(body, { status })) as unknown as typeof globalThis.fetch;
}

describe('refreshFeed', () => {
  it('does not stamp modifiedAt or urlAt on a 304 not-modified', async () => {
    const { refreshFeed } = await import('../src/feeds/scheduler');
    const id = 'feed-id';
    await upsertFeed({
      id,
      url: 'https://x.example/feed.xml',
      urlAt: 1000,
      modifiedAt: 2000,
      title: 'X',
      learnedIntervalMs: 3_600_000,
      lastFetched: null,
      etag: '"abc"',
    });
    stubFetch(304, '');
    await refreshFeed((await getFeed(id))!);
    const feed = (await getFeed(id))!;
    expect(feed.lastFetched).toBeTypeOf('number');
    expect(feed.modifiedAt).toBe(2000);
    expect(feed.urlAt).toBe(1000);
  });

  it('does not stamp modifiedAt or urlAt on a successful fetch', async () => {
    const { refreshFeed } = await import('../src/feeds/scheduler');
    const id = 'feed-id-2';
    await upsertFeed({
      id,
      url: 'https://x.example/feed.xml',
      urlAt: 1000,
      modifiedAt: 2000,
      title: 'X',
      learnedIntervalMs: 3_600_000,
      lastFetched: null,
    });
    stubFetch(200, RSS);
    await refreshFeed((await getFeed(id))!);
    const feed = (await getFeed(id))!;
    expect(feed.lastFetched).toBeTypeOf('number');
    expect(feed.modifiedAt).toBe(2000);
    expect(feed.urlAt).toBe(1000);
  });
});
