import { afterEach, describe, expect, it, vi } from 'vitest';
import { clearFeedCacheForTests, FEED_CACHE_TTL_MS, fetchFeedCached } from '../server/fetch';

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

  it('uses the fallback cooldown when Retry-After is absent', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const url = feedUrl();
    let calls = 0;
    vi.stubGlobal('fetch', (async () => {
      calls += 1;
      return new Response('limited', { status: 429 });
    }) as typeof globalThis.fetch);

    await fetchFeedCached(url);
    const suppressed = await fetchFeedCached(url);
    expect(suppressed.response.status).toBe(429);
    expect(suppressed.response.headers.get('Retry-After')).toBe(String(30 * 60));
    expect(calls).toBe(1);
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
