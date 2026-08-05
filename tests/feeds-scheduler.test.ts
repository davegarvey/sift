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

function stubFetch(status: number, body: string, headers?: Record<string, string>): void {
  // 304 is a null-body status; Response('', { status: 304 }) throws in Node.
  const payload = status === 304 ? null : body;
  globalThis.fetch = (async () =>
    new Response(payload, { status, headers })) as unknown as typeof globalThis.fetch;
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

  it('clamps an oversized Retry-After at 24h', async () => {
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
    expect(feed.refreshError?.retryAt).toBeGreaterThan(now + 24 * 3_600_000 - 5000);
    expect(feed.refreshError?.retryAt).toBeLessThan(now + 24 * 3_600_000 + 5000);
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
