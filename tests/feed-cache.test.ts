import { afterEach, describe, expect, it, vi } from 'vitest';
import { clearFeedCacheForTests, FEED_CACHE_TTL_MS, fetchFeedCached } from '../server/fetch';
import { LocalD1Database } from '../server/sync/local-d1';

let urlCounter = 0;

function feedUrl(): string {
  urlCounter += 1;
  return `https://cache-${urlCounter}.example/feed.xml`;
}

function response(body: string, headers: Record<string, string> = {}): Response {
  return new Response(body, { status: 200, headers });
}

interface TestCache {
  entries: Map<string, Response>;
  failMatch: boolean;
  failPut: boolean;
  match(request: Request): Promise<Response | undefined>;
  put(request: Request, response: Response): Promise<void>;
}

function testCache(): TestCache {
  const cache: TestCache = {
    entries: new Map(),
    failMatch: false,
    failPut: false,
    async match(request) {
      if (cache.failMatch) throw new Error('cache read failed');
      return cache.entries.get(request.url)?.clone();
    },
    async put(request, stored) {
      if (cache.failPut) throw new Error('cache write failed');
      cache.entries.set(request.url, stored.clone());
    },
  };
  return cache;
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  clearFeedCacheForTests();
});

describe('shared feed cache', () => {
  it('returns fresh hits without extending their expiry', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const url = feedUrl();
    let calls = 0;
    vi.stubGlobal('fetch', (async () => {
      calls += 1;
      return response('<rss>one</rss>', { ETag: '"one"' });
    }) as typeof globalThis.fetch);

    await fetchFeedCached(url);
    vi.advanceTimersByTime(FEED_CACHE_TTL_MS - 1000);
    const hit = await fetchFeedCached(url);
    expect(calls).toBe(1);
    expect(await hit.response.text()).toBe('<rss>one</rss>');
    expect(hit.response.headers.get('Age')).toBe(String(Math.floor((FEED_CACHE_TTL_MS - 1000) / 1000)));
    expect(hit.response.headers.get('X-Sift-Cache')).toBe('hit');

    vi.advanceTimersByTime(2000);
    await fetchFeedCached(url);
    expect(calls).toBe(2);
  });

  it('keeps query-bearing URLs isolated', async () => {
    const base = feedUrl();
    const first = `${base}?user=one`;
    const second = `${base}?user=two`;
    let calls = 0;
    vi.stubGlobal('fetch', (async (input) => {
      calls += 1;
      return response(new URL(String(input)).searchParams.get('user') ?? 'none');
    }) as typeof globalThis.fetch);

    expect(await (await fetchFeedCached(first)).response.text()).toBe('one');
    expect(await (await fetchFeedCached(second)).response.text()).toBe('two');
    expect(await (await fetchFeedCached(first)).response.text()).toBe('one');
    expect(calls).toBe(2);
  });

  it('uses shared validators upstream but applies client validators independently', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const url = feedUrl();
    let calls = 0;
    vi.stubGlobal('fetch', (async (_input, init) => {
      calls += 1;
      const headers = new Headers(init?.headers);
      if (calls === 1) {
        expect(headers.has('If-None-Match')).toBe(false);
        return response('<rss>one</rss>', { ETag: '"one"' });
      }
      expect(headers.get('If-None-Match')).toBe('"one"');
      return new Response(null, { status: 304, headers: { ETag: '"two"' } });
    }) as typeof globalThis.fetch);

    await fetchFeedCached(url);
    vi.advanceTimersByTime(FEED_CACHE_TTL_MS + 1);
    const olderClient = await fetchFeedCached(url, { etag: '"old"' });
    expect(olderClient.response.status).toBe(200);
    expect(olderClient.response.headers.get('ETag')).toBe('"two"');

    const currentClient = await fetchFeedCached(url, { etag: '"two"' });
    expect(currentClient.response.status).toBe(304);
    expect(calls).toBe(2);
  });

  it('uses Last-Modified when no client ETag is available', async () => {
    const url = feedUrl();
    vi.stubGlobal('fetch', (async () => response('<rss>one</rss>', {
      'Last-Modified': 'Wed, 01 Jan 2025 00:00:00 GMT',
    })) as typeof globalThis.fetch);

    await fetchFeedCached(url);
    const result = await fetchFeedCached(url, {
      lastModified: 'Wed, 01 Jan 2025 00:00:00 GMT',
    });
    expect(result.response.status).toBe(304);
  });

  it('coalesces concurrent revalidation requests', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const url = feedUrl();
    let calls = 0;
    let release: (value: Response) => void = () => {};
    const pending = new Promise<Response>((resolve) => { release = resolve; });
    vi.stubGlobal('fetch', (async () => {
      calls += 1;
      if (calls === 1) return response('<rss>one</rss>');
      return pending;
    }) as typeof globalThis.fetch);

    await fetchFeedCached(url);
    vi.advanceTimersByTime(FEED_CACHE_TTL_MS + 1);
    const first = fetchFeedCached(url);
    const second = fetchFeedCached(url, { etag: '"other"' });
    for (let i = 0; i < 5 && calls < 2; i += 1) await Promise.resolve();
    expect(calls).toBe(2);
    release(response('<rss>two</rss>', { ETag: '"two"' }));
    expect((await first).response.status).toBe(200);
    expect((await second).response.status).toBe(200);
    expect(calls).toBe(2);
  });

  it('suppresses upstream requests during a Retry-After cooldown', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const url = feedUrl();
    let calls = 0;
    vi.stubGlobal('fetch', (async () => {
      calls += 1;
      return new Response('limited', { status: 429, headers: { 'Retry-After': '60' } });
    }) as typeof globalThis.fetch);

    const first = await fetchFeedCached(url);
    const second = await fetchFeedCached(url);
    expect(first.response.status).toBe(429);
    expect(second.response.status).toBe(429);
    expect(second.response.headers.get('Retry-After')).toBe('60');
    expect(calls).toBe(1);

    vi.advanceTimersByTime(60_000);
    await fetchFeedCached(url);
    expect(calls).toBe(2);
  });

  it('uses the fallback cooldown when Retry-After is absent or unusable', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const url = feedUrl();
    let calls = 0;
    vi.stubGlobal('fetch', (async () => {
      calls += 1;
      return new Response('limited', { status: 429, headers: { 'Retry-After': 'not-a-delay' } });
    }) as typeof globalThis.fetch);

    await fetchFeedCached(url);
    const suppressed = await fetchFeedCached(url);
    expect(suppressed.response.status).toBe(429);
    expect(suppressed.response.headers.get('Retry-After')).toBe(String(30 * 60));
    expect(calls).toBe(1);
  });

  it('cools down generic upstream failures instead of retrying them immediately', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const url = feedUrl();
    let calls = 0;
    vi.stubGlobal('fetch', (async () => {
      calls += 1;
      return new Response('Sorry', { status: 419 });
    }) as typeof globalThis.fetch);

    const first = await fetchFeedCached(url);
    const second = await fetchFeedCached(url);
    expect(first.response.status).toBe(419);
    expect(second.response.status).toBe(419);
    expect(second.response.headers.get('X-Sift-Cache')).toBe('cooldown');
    expect(calls).toBe(1);

    vi.advanceTimersByTime(30 * 60_000);
    await fetchFeedCached(url);
    expect(calls).toBe(2);
  });

  it('represents network failures as 502 and cools them down', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const url = feedUrl();
    let calls = 0;
    vi.stubGlobal('fetch', (async () => {
      calls += 1;
      throw new Error('network unavailable');
    }) as typeof globalThis.fetch);

    const first = await fetchFeedCached(url);
    const second = await fetchFeedCached(url);
    expect(first.response.status).toBe(502);
    expect(second.response.status).toBe(502);
    expect(second.response.headers.get('Retry-After')).toBe(String(30 * 60));
    expect(calls).toBe(1);
  });

  it('accepts HTTP-date Retry-After values and caps long delays', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
    const dateUrl = feedUrl();
    const cappedUrl = feedUrl();
    let dateCalls = 0;
    let cappedCalls = 0;
    vi.stubGlobal('fetch', (async (input) => {
      if (String(input) === dateUrl) {
        dateCalls += 1;
        return new Response('limited', {
          status: 503,
          headers: { 'Retry-After': new Date(Date.now() + 60_000).toUTCString() },
        });
      }
      cappedCalls += 1;
      return new Response('limited', { status: 503, headers: { 'Retry-After': '999999999' } });
    }) as typeof globalThis.fetch);

    await fetchFeedCached(dateUrl);
    const dateSuppressed = await fetchFeedCached(dateUrl);
    expect(dateSuppressed.response.headers.get('Retry-After')).toBe('60');
    expect(dateCalls).toBe(1);

    await fetchFeedCached(cappedUrl);
    const cappedSuppressed = await fetchFeedCached(cappedUrl);
    expect(cappedSuppressed.response.headers.get('Retry-After')).toBe(String(24 * 60 * 60));
    expect(cappedCalls).toBe(1);
  });

  it('does not cool down redirects', async () => {
    const url = feedUrl();
    let calls = 0;
    vi.stubGlobal('fetch', (async () => {
      calls += 1;
      return new Response(null, { status: 302, headers: { Location: '/new-feed.xml' } });
    }) as typeof globalThis.fetch);

    const first = await fetchFeedCached(url);
    const second = await fetchFeedCached(url);
    expect(first.response.status).toBe(302);
    expect(second.response.status).toBe(302);
    expect(second.response.headers.get('X-Sift-Cache')).not.toBe('cooldown');
    expect(calls).toBe(2);
  });

  it('shares generic failure cooldowns through the Worker cache', async () => {
    const url = feedUrl();
    const cache = testCache();
    vi.stubGlobal('caches', { default: cache });
    let calls = 0;
    vi.stubGlobal('fetch', (async () => {
      calls += 1;
      return new Response('Sorry', { status: 419 });
    }) as typeof globalThis.fetch);

    await fetchFeedCached(url);
    clearFeedCacheForTests();
    const suppressed = await fetchFeedCached(url);
    expect(suppressed.response.status).toBe(419);
    expect(suppressed.response.headers.get('X-Sift-Cache')).toBe('cooldown');
    expect(calls).toBe(1);
  });

  it('shares generic failure cooldowns through D1', async () => {
    const url = feedUrl();
    const db = new LocalD1Database() as unknown as D1Database;
    let calls = 0;
    vi.stubGlobal('fetch', (async () => {
      calls += 1;
      return new Response('Sorry', { status: 419 });
    }) as typeof globalThis.fetch);

    await fetchFeedCached(url, {}, db);
    clearFeedCacheForTests();
    const suppressed = await fetchFeedCached(url, {}, db);
    expect(suppressed.response.status).toBe(419);
    expect(suppressed.response.headers.get('X-Sift-Cache')).toBe('cooldown');
    expect(calls).toBe(1);
  });

  it('continues fetching when D1 failure-state operations are unavailable', async () => {
    const url = feedUrl();
    const db = {
      prepare() {
        throw new Error('D1 unavailable');
      },
    } as unknown as D1Database;
    let calls = 0;
    vi.stubGlobal('fetch', (async () => {
      calls += 1;
      return response('<rss>available</rss>');
    }) as typeof globalThis.fetch);

    const result = await fetchFeedCached(url, {}, db);
    expect(result.response.status).toBe(200);
    expect(await result.response.text()).toBe('<rss>available</rss>');
    expect(calls).toBe(1);
  });

  it('retains the previous representation after a stale generic failure', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const url = feedUrl();
    let calls = 0;
    vi.stubGlobal('fetch', (async (_input, init) => {
      calls += 1;
      if (calls === 1) return response('<rss>one</rss>', { ETag: '"one"' });
      const headers = new Headers(init?.headers);
      expect(headers.get('If-None-Match')).toBe('"one"');
      if (calls === 2) return new Response('Sorry', { status: 419, headers: { 'X-Upstream': 'failure' } });
      return new Response(null, { status: 304, headers: { ETag: '"one"' } });
    }) as typeof globalThis.fetch);

    await fetchFeedCached(url);
    vi.advanceTimersByTime(FEED_CACHE_TTL_MS + 1);
    const failed = await fetchFeedCached(url);
    expect(failed.response.status).toBe(419);
    expect(failed.response.headers.get('X-Upstream')).toBe('failure');
    expect(await failed.response.text()).toBe('Sorry');

    vi.advanceTimersByTime(30 * 60_000);
    const recovered = await fetchFeedCached(url);
    expect(recovered.response.status).toBe(200);
    expect(await recovered.response.text()).toBe('<rss>one</rss>');
    expect(calls).toBe(3);
  });

  it('does not write shared failure state during successful refreshes', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const url = feedUrl();
    const local = new LocalD1Database();
    const queries: string[] = [];
    const db = {
      prepare(sql: string) {
        queries.push(sql);
        return local.prepare(sql);
      },
    } as unknown as D1Database;
    let calls = 0;
    vi.stubGlobal('fetch', (async () => {
      calls += 1;
      if (calls === 1) return response('<rss>one</rss>', { ETag: '"one"' });
      return new Response(null, { status: 304, headers: { ETag: '"one"' } });
    }) as typeof globalThis.fetch);

    await fetchFeedCached(url, {}, db);
    vi.advanceTimersByTime(FEED_CACHE_TTL_MS + 1);
    await fetchFeedCached(url, {}, db);

    expect(queries.some((sql) => /INSERT\s+INTO\s+feed_fetch_failures|DELETE\s+FROM\s+feed_fetch_failures/i.test(sql))).toBe(false);
    expect(calls).toBe(2);
  });

  it('restores a cached representation after memory state is cleared', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const url = feedUrl();
    const cache = testCache();
    vi.stubGlobal('caches', { default: cache });
    let calls = 0;
    vi.stubGlobal('fetch', (async () => {
      calls += 1;
      return response('<rss>worker</rss>', { ETag: '"worker"' });
    }) as typeof globalThis.fetch);

    await fetchFeedCached(url);
    clearFeedCacheForTests();
    vi.stubGlobal('fetch', (async () => {
      calls += 1;
      throw new Error('upstream should not be called');
    }) as typeof globalThis.fetch);

    vi.advanceTimersByTime(30_000);
    const hit = await fetchFeedCached(url, { etag: '"worker"' });
    expect(hit.response.status).toBe(304);
    expect(hit.response.headers.get('Age')).toBe('30');
    expect(hit.response.headers.get('Cache-Control')).toBe('no-cache, no-store');
    expect(calls).toBe(1);
  });

  it('keeps URL query variants isolated in the Worker cache', async () => {
    const base = feedUrl();
    const first = `${base}?user=one`;
    const second = `${base}?user=two`;
    const cache = testCache();
    vi.stubGlobal('caches', { default: cache });
    let calls = 0;
    vi.stubGlobal('fetch', (async (input) => {
      calls += 1;
      return response(new URL(String(input)).searchParams.get('user') ?? 'none');
    }) as typeof globalThis.fetch);

    expect(await (await fetchFeedCached(first)).response.text()).toBe('one');
    clearFeedCacheForTests();
    expect(await (await fetchFeedCached(second)).response.text()).toBe('two');
    clearFeedCacheForTests();
    expect(await (await fetchFeedCached(first)).response.text()).toBe('one');
    expect(calls).toBe(2);
    expect(cache.entries.size).toBe(2);
  });

  it('falls back to memory when Worker cache writes fail', async () => {
    const url = feedUrl();
    const cache = testCache();
    cache.failPut = true;
    vi.stubGlobal('caches', { default: cache });
    let calls = 0;
    vi.stubGlobal('fetch', (async () => {
      calls += 1;
      return response('<rss>fallback</rss>');
    }) as typeof globalThis.fetch);

    await fetchFeedCached(url);
    const hit = await fetchFeedCached(url);
    expect(await hit.response.text()).toBe('<rss>fallback</rss>');
    expect(hit.response.headers.get('X-Sift-Cache')).toBe('hit');
    expect(calls).toBe(1);
  });

  it('treats Worker cache read failures as misses', async () => {
    const url = feedUrl();
    const cache = testCache();
    cache.failMatch = true;
    vi.stubGlobal('caches', { default: cache });
    let calls = 0;
    vi.stubGlobal('fetch', (async () => {
      calls += 1;
      return response('<rss>miss</rss>');
    }) as typeof globalThis.fetch);

    const result = await fetchFeedCached(url);
    expect(await result.response.text()).toBe('<rss>miss</rss>');
    expect(calls).toBe(1);
  });
});
