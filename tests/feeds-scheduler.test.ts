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
import { bulkUpsertItems } from '../src/db/items';
import { parseFeed, parsedToItems } from '../src/feeds/parse';

beforeEach(async () => {
  const db = await getDb();
  await db.clear('feeds');
  await db.clear('items');
  await db.clear('itemFlags');
  await db.clear('feedStats');
  await db.clear('readMarkers');
});

const RSS = `<rss version="2.0"><channel><title>X</title><link>https://x.example</link><description>d</description></channel></rss>`;

function rssWithItems(ids: string[]): string {
  const date = new Date(Date.now() - 60_000).toUTCString();
  const entries = ids.map((id) => `<item><guid>${id}</guid><title>${id}</title><link>https://x.example/${id}</link><pubDate>${date}</pubDate></item>`).join('');
  return `<rss version="2.0"><channel><title>X</title><link>https://x.example</link><description>d</description>${entries}</channel></rss>`;
}

function stubFetch(status: number, body: string, headers?: Record<string, string>): void {
  // 304 is a null-body status; Response('', { status: 304 }) throws in Node.
  const payload = status === 304 ? null : body;
  globalThis.fetch = (async () =>
    new Response(payload, { status, headers })) as unknown as typeof globalThis.fetch;
}

describe('refreshFeed', () => {
  it('force-refreshes only the explicit target IDs', async () => {
    const { refreshStaleFeeds } = await import('../src/feeds/scheduler');
    await upsertFeed({
      id: 'target-feed',
      url: 'https://target.example/feed.xml',
      title: 'Target',
      learnedIntervalMs: 3_600_000,
      lastFetched: Date.now(),
    });
    await upsertFeed({
      id: 'other-feed',
      url: 'https://other.example/feed.xml',
      title: 'Other',
      learnedIntervalMs: 3_600_000,
      lastFetched: Date.now(),
    });
    const calls: string[] = [];
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      calls.push(String(input));
      return new Response(null, { status: 304 });
    }) as unknown as typeof globalThis.fetch;

    await refreshStaleFeeds({ forceAll: true, target: new Set(['target-feed']) });

    expect(calls).toHaveLength(1);
    expect(calls[0]).toContain(encodeURIComponent('https://target.example/feed.xml'));
  });

  it('does not fetch when the explicit target is empty', async () => {
    const { refreshStaleFeeds } = await import('../src/feeds/scheduler');
    await upsertFeed({
      id: 'empty-target-feed',
      url: 'https://empty-target.example/feed.xml',
      title: 'Feed',
      learnedIntervalMs: 3_600_000,
      lastFetched: null,
    });
    let calls = 0;
    globalThis.fetch = (async () => {
      calls++;
      return new Response(null, { status: 304 });
    }) as unknown as typeof globalThis.fetch;

    await refreshStaleFeeds({ forceAll: true, target: new Set() });

    expect(calls).toBe(0);
  });

  it('coalesces concurrent refreshes for the same feed', async () => {
    const { refreshFeed } = await import('../src/feeds/scheduler');
    const id = 'coalesced-feed';
    await upsertFeed({
      id,
      url: 'https://coalesced.example/feed.xml',
      title: 'Feed',
      learnedIntervalMs: 3_600_000,
      lastFetched: null,
    });
    let calls = 0;
    let release: (() => void) | undefined;
    const blocked = new Promise<void>((resolve) => { release = resolve; });
    globalThis.fetch = (async () => {
      calls++;
      await blocked;
      return new Response(null, { status: 304 });
    }) as unknown as typeof globalThis.fetch;

    const feed = (await getFeed(id))!;
    const first = refreshFeed(feed);
    const second = refreshFeed(feed);
    release!();
    await Promise.all([first, second]);

    expect(calls).toBe(1);
  });

  it('does not invoke the background callback for a forced targeted refresh', async () => {
    const { refreshStaleFeeds, setOnRefresh } = await import('../src/feeds/scheduler');
    await upsertFeed({
      id: 'forced-callback',
      url: 'https://forced.example/feed.xml',
      title: 'Forced',
      learnedIntervalMs: 3_600_000,
      lastFetched: null,
    });
    stubFetch(304, '');
    const callback = vi.fn();
    setOnRefresh(callback);
    try {
      await refreshStaleFeeds({ forceAll: true, target: new Set(['forced-callback']) });
    } finally {
      setOnRefresh(null);
    }

    expect(callback).not.toHaveBeenCalled();
  });

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

  it('does not refresh an error feed before retryAt even when lastFetched is old', async () => {
    const { refreshStaleFeeds } = await import('../src/feeds/scheduler');
    const id = 'feed-id-3';
    await upsertFeed({
      id,
      url: 'https://x.example/feed.xml',
      title: 'X',
      learnedIntervalMs: 3_600_000,
      lastFetched: Date.now() - 10 * 24 * 3_600_000,
      refreshError: { retryAt: Date.now() + 3_600_000, attempts: 1, lastStatus: 429, lastRetryAfter: null },
    });
    let calls = 0;
    globalThis.fetch = (async () => {
      calls++;
      return new Response('', { status: 500 });
    }) as unknown as typeof globalThis.fetch;
    await refreshStaleFeeds();
    await refreshStaleFeeds({ forceAll: true });
    expect(calls).toBe(0);
  });

  it('refreshes an error feed once retryAt has passed', async () => {
    const { refreshStaleFeeds } = await import('../src/feeds/scheduler');
    const id = 'feed-id-4';
    await upsertFeed({
      id,
      url: 'https://x.example/feed.xml',
      title: 'X',
      learnedIntervalMs: 3_600_000,
      lastFetched: null,
      refreshError: { retryAt: Date.now() - 1000, attempts: 3, lastStatus: 429, lastRetryAfter: null },
    });
    let calls = 0;
    globalThis.fetch = (async () => {
      calls++;
      return new Response('', { status: 429 });
    }) as unknown as typeof globalThis.fetch;
    await refreshStaleFeeds();
    expect(calls).toBe(1);
  });

  it('honors Retry-After beyond the generic ceiling without touching learnedIntervalMs', async () => {
    const { refreshFeed } = await import('../src/feeds/scheduler');
    const id = 'feed-id-5';
    await upsertFeed({
      id,
      url: 'https://x.example/feed.xml',
      title: 'X',
      learnedIntervalMs: 3_600_000,
      lastFetched: null,
    });
    const now = Date.now();
    stubFetch(429, '', { 'Retry-After': String(10 * 3600) });
    await refreshFeed((await getFeed(id))!);
    const feed = (await getFeed(id))!;
    expect(feed.refreshError?.retryAt).toBeGreaterThan(now + 10 * 3_600_000 - 5000);
    expect(feed.refreshError?.retryAt).toBeLessThan(now + 10 * 3_600_000 + 5000);
    expect(feed.refreshError?.lastStatus).toBe(429);
    expect(feed.learnedIntervalMs).toBe(3_600_000);
    expect(feed.lastFetched).toBeNull();
  });

  it('does not clamp an oversized Retry-After at 24h', async () => {
    const { refreshFeed } = await import('../src/feeds/scheduler');
    const id = 'feed-id-6';
    await upsertFeed({
      id,
      url: 'https://x.example/feed.xml',
      title: 'X',
      learnedIntervalMs: 3_600_000,
      lastFetched: null,
    });
    const now = Date.now();
    stubFetch(429, '', { 'Retry-After': String(48 * 3600) });
    await refreshFeed((await getFeed(id))!);
    const feed = (await getFeed(id))!;
    expect(feed.refreshError?.retryAt).toBeGreaterThan(now + 48 * 3_600_000 - 5000);
    expect(feed.refreshError?.retryAt).toBeLessThan(now + 48 * 3_600_000 + 5000);
  });

  it('honors Retry-After on a 419 response', async () => {
    const { refreshFeed } = await import('../src/feeds/scheduler');
    const id = 'feed-id-419';
    await upsertFeed({
      id,
      url: 'https://x.example/feed.xml',
      title: 'X',
      learnedIntervalMs: 3_600_000,
      lastFetched: null,
    });
    const now = Date.now();
    stubFetch(419, '', { 'Retry-After': String(48 * 3600) });
    await refreshFeed((await getFeed(id))!);
    const feed = (await getFeed(id))!;
    expect(feed.refreshError?.lastStatus).toBe(419);
    expect(feed.refreshError?.retryAt).toBeGreaterThan(now + 48 * 3_600_000 - 5000);
    expect(feed.refreshError?.retryAt).toBeLessThan(now + 48 * 3_600_000 + 5000);
  });

  it('does not relearn a shorter cadence from an unchanged large snapshot', async () => {
    const { refreshFeed } = await import('../src/feeds/scheduler');
    const id = 'unchanged-snapshot';
    const body = rssWithItems(Array.from({ length: 20 }, (_, index) => `item-${index}`));
    const parsed = parseFeed(body, 'https://x.example/feed.xml')!;
    await upsertFeed({
      id,
      url: 'https://x.example/feed.xml',
      title: 'X',
      learnedIntervalMs: 60 * 60_000,
      lastFetched: Date.now() - 4 * 60 * 60_000,
    });
    await bulkUpsertItems(parsedToItems(parsed, id));
    stubFetch(200, body);

    await refreshFeed((await getFeed(id))!);

    expect((await getFeed(id))!.learnedIntervalMs).toBe(60 * 60_000);
  });

  it('learns cadence from new IDs and respects the minimum interval', async () => {
    const { refreshFeed } = await import('../src/feeds/scheduler');
    const id = 'new-arrivals';
    await upsertFeed({
      id,
      url: 'https://x.example/feed.xml',
      title: 'X',
      learnedIntervalMs: 31 * 60_000,
      lastFetched: Date.now() - 4 * 60 * 60_000,
    });
    stubFetch(200, rssWithItems(Array.from({ length: 20 }, (_, index) => `new-${index}`)));

    await refreshFeed((await getFeed(id))!);

    expect((await getFeed(id))!.learnedIntervalMs).toBe(30 * 60_000);
  });

  it('uses stable jitter without scheduling before the learned interval', async () => {
    const { scheduledFeedDueAt, stableFeedJitter } = await import('../src/feeds/scheduler');
    const startedAt = 1_000_000;
    const feed = {
      id: 'stable-jitter',
      url: 'https://x.example/feed.xml',
      title: 'X',
      learnedIntervalMs: 60 * 60_000,
      lastFetched: startedAt - 2 * 60 * 60_000,
    };
    const due = scheduledFeedDueAt(feed, startedAt, startedAt);

    expect(stableFeedJitter(feed.id)).toBe(stableFeedJitter(feed.id));
    expect(due).toBe(startedAt + stableFeedJitter(feed.id));
    expect(due).toBeGreaterThanOrEqual(feed.lastFetched + feed.learnedIntervalMs);
    expect(due).toBeLessThan(startedAt + 15 * 60_000);
  });

  it('escalates generic errors exponentially from 30min to a 6h ceiling', async () => {
    const { refreshFeed } = await import('../src/feeds/scheduler');
    const id = 'feed-id-7';
    await upsertFeed({
      id,
      url: 'https://x.example/feed.xml',
      title: 'X',
      learnedIntervalMs: 3_600_000,
      lastFetched: null,
    });
    const deltas: number[] = [];
    for (let i = 0; i < 6; i++) {
      const now = Date.now();
      stubFetch(500, '');
      await refreshFeed((await getFeed(id))!);
      const feed = (await getFeed(id))!;
      deltas.push(feed.refreshError!.retryAt - now);
    }
    expect(deltas[0]).toBeGreaterThan(29 * 60_000);
    expect(deltas[0]).toBeLessThan(31 * 60_000);
    expect(deltas[1]).toBeGreaterThan(59 * 60_000);
    expect(deltas[1]).toBeLessThan(61 * 60_000);
    expect(deltas[2]).toBeGreaterThan(119 * 60_000);
    expect(deltas[2]).toBeLessThan(121 * 60_000);
    expect(deltas[4]).toBeGreaterThan(359 * 60_000);
    expect(deltas[4]).toBeLessThan(361 * 60_000);
    expect(deltas[5]).toBeGreaterThan(359 * 60_000);
    expect(deltas[5]).toBeLessThan(361 * 60_000);
  });

  it('clears error state and resets an inflated learnedIntervalMs on success', async () => {
    const { refreshFeed } = await import('../src/feeds/scheduler');
    const id = 'feed-id-8';
    await upsertFeed({
      id,
      url: 'https://x.example/feed.xml',
      title: 'X',
      learnedIntervalMs: 24 * 3_600_000,
      lastFetched: null,
      lastError: 'HTTP 429',
      refreshError: { retryAt: Date.now() + 3_600_000, attempts: 4, lastStatus: 429, lastRetryAfter: 3600 },
    });
    stubFetch(200, RSS);
    await refreshFeed((await getFeed(id))!);
    const feed = (await getFeed(id))!;
    expect(feed.refreshError).toBeNull();
    expect(feed.lastError).toBeNull();
    expect(feed.learnedIntervalMs).toBe(60 * 60 * 1000);
  });

  it('clears error state on 304 but leaves learnedIntervalMs unchanged', async () => {
    const { refreshFeed } = await import('../src/feeds/scheduler');
    const id = 'feed-id-9';
    await upsertFeed({
      id,
      url: 'https://x.example/feed.xml',
      title: 'X',
      learnedIntervalMs: 24 * 3_600_000,
      lastFetched: null,
      lastError: 'HTTP 429',
      refreshError: { retryAt: Date.now() + 3_600_000, attempts: 4, lastStatus: 429, lastRetryAfter: 3600 },
      etag: '"abc"',
    });
    stubFetch(304, '');
    await refreshFeed((await getFeed(id))!);
    const feed = (await getFeed(id))!;
    expect(feed.refreshError).toBeNull();
    expect(feed.lastError).toBeNull();
    expect(feed.learnedIntervalMs).toBe(24 * 3_600_000);
  });

  it('backs off parse failures as generic errors without touching learnedIntervalMs', async () => {
    const { refreshFeed } = await import('../src/feeds/scheduler');
    const id = 'feed-id-10';
    await upsertFeed({
      id,
      url: 'https://x.example/feed.xml',
      title: 'X',
      learnedIntervalMs: 3_600_000,
      lastFetched: null,
    });
    const now = Date.now();
    stubFetch(200, 'this is not a feed');
    await refreshFeed((await getFeed(id))!);
    const feed = (await getFeed(id))!;
    expect(feed.refreshError?.lastStatus).toBe(200);
    expect(feed.refreshError?.retryAt).toBeGreaterThan(now + 29 * 60_000);
    expect(feed.refreshError?.retryAt).toBeLessThan(now + 31 * 60_000);
    expect(feed.lastError).toBe('Failed to parse feed');
    expect(feed.learnedIntervalMs).toBe(3_600_000);
  });

});

describe('refresh status', () => {
  async function seed(id: string, sourceFetchedAt: number | null): Promise<void> {
    await upsertFeed({
      id,
      url: `https://${id}.example/feed.xml`,
      title: 'Feed',
      learnedIntervalMs: 3_600_000,
      lastFetched: null,
      sourceFetchedAt,
    });
  }

  it('records when the server received the feed and its next check', async () => {
    const { refreshFeed } = await import('../src/feeds/scheduler');
    await seed('status-feed', null);
    stubFetch(200, RSS, { Age: '2400', 'X-Sift-Retry-After': '900' });
    const now = Date.now();
    await refreshFeed((await getFeed('status-feed'))!);
    const feed = (await getFeed('status-feed'))!;
    expect(feed.sourceFetchedAt).toBeGreaterThan(now - 2_400_000 - 5000);
    expect(feed.sourceFetchedAt).toBeLessThan(now - 2_400_000 + 5000);
    expect(feed.nextCheckAt).toBeGreaterThan(now + 895_000);
    expect(feed.nextCheckAt).toBeLessThan(now + 905_000);

    stubFetch(304, '');
    await refreshFeed(feed);
    const refreshed = (await getFeed('status-feed'))!;
    expect(refreshed.nextCheckAt).toBeNull();
    expect(refreshed.sourceFetchedAt).toBeGreaterThanOrEqual(now);
  });

  it('keeps a rate limit on a recently received feed quiet but still backs off', async () => {
    const { refreshFeed, fetchingState } = await import('../src/feeds/scheduler');
    await seed('quiet-feed', Date.now() - 2 * 3_600_000);
    stubFetch(429, '', { 'Retry-After': '600' });
    await refreshFeed((await getFeed('quiet-feed'))!);
    expect(fetchingState.feedErrors()['quiet-feed']).toBeUndefined();
    expect((await getFeed('quiet-feed'))!.refreshError?.lastStatus).toBe(429);
  });

  it('shows non-transient and prolonged failures', async () => {
    const { refreshFeed, fetchingState } = await import('../src/feeds/scheduler');
    await seed('gone-feed', Date.now() - 60_000);
    stubFetch(404, 'missing');
    await refreshFeed((await getFeed('gone-feed'))!);
    expect(fetchingState.feedErrors()['gone-feed']).toBe('HTTP 404');

    await seed('prolonged-feed', Date.now() - 25 * 3_600_000);
    stubFetch(429, '');
    await refreshFeed((await getFeed('prolonged-feed'))!);
    expect(fetchingState.feedErrors()['prolonged-feed']).toBe('HTTP 429');

    await seed('new-feed', null);
    stubFetch(503, '');
    await refreshFeed((await getFeed('new-feed'))!);
    expect(fetchingState.feedErrors()['new-feed']).toBe('HTTP 503');
  });
});

