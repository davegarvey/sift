import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  clearFeedCacheForTests,
  FEED_CACHE_MAX_FRESHNESS_MS,
  FEED_CACHE_TTL_MS,
  FEED_STALE_RETENTION_MS,
  fetchFeedCached,
} from '../server/fetch';
import { clearOriginGovernorForTests } from '../server/origin-governor';
import { LocalD1Database } from '../server/sync/local-d1';

let urlCounter = 0;

function feedUrl(): string {
  urlCounter += 1;
  return `http://93.184.216.34/cache-${urlCounter}.example/feed.xml`;
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
  clearOriginGovernorForTests();
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
    await vi.advanceTimersByTimeAsync(1_000);
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

  it('does not shorten a 429 Retry-After longer than 24 hours', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const url = feedUrl();
    let calls = 0;
    vi.stubGlobal('fetch', (async () => {
      calls += 1;
      return new Response('limited', { status: 429, headers: { 'Retry-After': String(48 * 60 * 60) } });
    }) as typeof globalThis.fetch);

    const first = await fetchFeedCached(url);
    const suppressed = await fetchFeedCached(url);
    expect(first.response.headers.get('Retry-After')).toBe(String(48 * 60 * 60));
    expect(suppressed.response.headers.get('Retry-After')).toBe(String(48 * 60 * 60));
    expect(calls).toBe(1);
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

  it('applies the initial six-hour origin cooldown to a headerless challenge response', async () => {
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

    expect(first.response.headers.get('Retry-After')).toBe(String(6 * 60 * 60));

    vi.advanceTimersByTime(6 * 60 * 60_000);
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

  it('accepts HTTP-date Retry-After values and caps long non-rate-limit delays', async () => {
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

    await vi.advanceTimersByTimeAsync(1_000);
    await fetchFeedCached(cappedUrl);
    const cappedSuppressed = await fetchFeedCached(cappedUrl);
    expect(cappedSuppressed.response.headers.get('Retry-After')).toBe(String(24 * 60 * 60));
    expect(cappedCalls).toBe(1);
  });

  it('follows public redirects without entering failure cooldown', async () => {
    const url = feedUrl();
    let calls = 0;
    vi.stubGlobal('fetch', (async () => {
      calls += 1;
      return calls === 1
        ? new Response(null, { status: 302, headers: { Location: '/new-feed.xml' } })
        : response('<rss>redirected</rss>');
    }) as typeof globalThis.fetch);

    const first = await fetchFeedCached(url);
    const second = await fetchFeedCached(url);
    expect(first.response.status).toBe(200);
    expect(await first.response.text()).toBe('<rss>redirected</rss>');
    expect(second.response.status).toBe(200);
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

  it('keeps a stale success representation when storing a Worker cooldown marker', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const url = feedUrl();
    const cache = testCache();
    vi.stubGlobal('caches', { default: cache });
    vi.stubGlobal('fetch', (async () => response('<rss>cached</rss>', { ETag: '"cached"' })) as typeof globalThis.fetch);
    await fetchFeedCached(url);

    vi.advanceTimersByTime(FEED_CACHE_TTL_MS + 1);
    vi.stubGlobal('fetch', (async () => new Response('challenge', { status: 419 })) as typeof globalThis.fetch);
    await fetchFeedCached(url);

    expect(cache.entries.size).toBe(2);
    expect(cache.entries.get(url)?.status).toBe(200);
    expect(cache.entries.get(url)?.headers.get('ETag')).toBe('"cached"');
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
    expect(failed.response.status).toBe(200);
    expect(failed.response.headers.get('X-Sift-Cache')).toBe('stale');
    expect(await failed.response.text()).toBe('<rss>one</rss>');

    vi.advanceTimersByTime(6 * 60 * 60_000);
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

describe('feed cache freshness and stale serving', () => {
  function countingFetch(handler: (call: number) => Response | Promise<Response>): () => number {
    let calls = 0;
    vi.stubGlobal('fetch', (async () => {
      calls += 1;
      return handler(calls);
    }) as typeof globalThis.fetch);
    return () => calls;
  }

  function fetchUngoverned(url: string) {
    clearOriginGovernorForTests();
    return fetchFeedCached(url);
  }

  it('caches responses that set cookies or vary on everything', async () => {
    const url = feedUrl();
    const calls = countingFetch(() => response('<rss>cookie</rss>', { 'Set-Cookie': 'session=abc', Vary: '*' }));

    await fetchFeedCached(url);
    const hit = await fetchFeedCached(url);
    expect(hit.response.headers.get('X-Sift-Cache')).toBe('hit');
    expect(hit.response.headers.has('Set-Cookie')).toBe(false);
    expect(calls()).toBe(1);
  });

  it('extends freshness to an upstream max-age', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const url = feedUrl();
    const calls = countingFetch(() => response('<rss>one</rss>', { 'Cache-Control': 'public, max-age=3600' }));

    await fetchFeedCached(url);
    vi.advanceTimersByTime(60 * 60_000 - 1000);
    expect((await fetchFeedCached(url)).response.headers.get('X-Sift-Cache')).toBe('hit');
    vi.advanceTimersByTime(2000);
    await fetchFeedCached(url);
    expect(calls()).toBe(2);
  });

  it('prefers s-maxage and falls back to Expires', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const shared = feedUrl();
    const expiring = feedUrl();
    let sharedCalls = 0;
    let expiringCalls = 0;
    vi.stubGlobal('fetch', (async (input) => {
      if (String(input) === shared) {
        sharedCalls += 1;
        return response('<rss/>', { 'Cache-Control': 'max-age=60, s-maxage=7200' });
      }
      expiringCalls += 1;
      return response('<rss/>', {
        Date: new Date(0).toUTCString(),
        Expires: new Date(3 * 60 * 60_000).toUTCString(),
      });
    }) as typeof globalThis.fetch);

    await fetchUngoverned(shared);
    await fetchUngoverned(expiring);
    vi.advanceTimersByTime(2 * 60 * 60_000 - 1000);
    await fetchUngoverned(shared);
    await fetchUngoverned(expiring);
    expect(sharedCalls).toBe(1);
    expect(expiringCalls).toBe(1);
  });

  it('uses feed ttl and syndication hints', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const ttlUrl = feedUrl();
    const syUrl = feedUrl();
    let ttlCalls = 0;
    let syCalls = 0;
    vi.stubGlobal('fetch', (async (input) => {
      if (String(input) === ttlUrl) {
        ttlCalls += 1;
        return response('<rss><channel><ttl>120</ttl></channel></rss>');
      }
      syCalls += 1;
      return response('<rss><channel><sy:updatePeriod>daily</sy:updatePeriod><sy:updateFrequency>4</sy:updateFrequency></channel></rss>');
    }) as typeof globalThis.fetch);

    await fetchUngoverned(ttlUrl);
    await fetchUngoverned(syUrl);
    vi.advanceTimersByTime(2 * 60 * 60_000 - 1000);
    await fetchUngoverned(ttlUrl);
    await fetchUngoverned(syUrl);
    expect(ttlCalls).toBe(1);
    expect(syCalls).toBe(1);
    vi.advanceTimersByTime(2000);
    await fetchUngoverned(ttlUrl);
    expect(ttlCalls).toBe(2);
    vi.advanceTimersByTime(4 * 60 * 60_000);
    await fetchUngoverned(syUrl);
    expect(syCalls).toBe(2);
  });

  it('bounds short and excessive hints', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const short = feedUrl();
    const long = feedUrl();
    let shortCalls = 0;
    let longCalls = 0;
    vi.stubGlobal('fetch', (async (input) => {
      if (String(input) === short) {
        shortCalls += 1;
        return response('<rss/>', { 'Cache-Control': 'max-age=0' });
      }
      longCalls += 1;
      return response('<rss/>', { 'Cache-Control': 'max-age=31536000' });
    }) as typeof globalThis.fetch);

    await fetchUngoverned(short);
    await fetchUngoverned(long);
    vi.advanceTimersByTime(FEED_CACHE_TTL_MS - 1000);
    await fetchUngoverned(short);
    expect(shortCalls).toBe(1);
    vi.advanceTimersByTime(FEED_CACHE_MAX_FRESHNESS_MS);
    await fetchUngoverned(long);
    expect(longCalls).toBe(2);
  });

  it('recomputes freshness after a 304 revalidation', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const url = feedUrl();
    const calls = countingFetch((call) => call === 1
      ? response('<rss/>', { ETag: '"one"' })
      : new Response(null, { status: 304, headers: { ETag: '"one"', 'Cache-Control': 'max-age=7200' } }));

    await fetchFeedCached(url);
    vi.advanceTimersByTime(FEED_CACHE_TTL_MS + 1);
    await fetchFeedCached(url);
    vi.advanceTimersByTime(2 * 60 * 60_000 - 1000);
    expect((await fetchFeedCached(url)).response.headers.get('X-Sift-Cache')).toBe('hit');
    expect(calls()).toBe(2);
  });

  it('serves the retained copy to other clients during a rate-limit cooldown', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const url = feedUrl();
    const calls = countingFetch((call) => call === 1
      ? response('<rss>kept</rss>', { ETag: '"kept"' })
      : new Response('limited', { status: 429, headers: { 'Retry-After': '600' } }));

    await fetchFeedCached(url);
    vi.advanceTimersByTime(FEED_CACHE_TTL_MS + 60_000);
    const first = await fetchFeedCached(url);
    expect(first.response.status).toBe(200);
    expect(first.response.headers.get('X-Sift-Cache')).toBe('stale');
    expect(first.response.headers.get('X-Sift-Retry-After')).toBe('600');
    expect(first.response.headers.get('Age')).toBe(String((FEED_CACHE_TTL_MS + 60_000) / 1000));

    vi.advanceTimersByTime(100_000);
    const other = await fetchFeedCached(url);
    expect(await other.response.text()).toBe('<rss>kept</rss>');
    expect(other.response.headers.get('X-Sift-Retry-After')).toBe('500');
    const current = await fetchFeedCached(url, { etag: '"kept"' });
    expect(current.response.status).toBe(304);
    expect(current.response.headers.get('X-Sift-Cache')).toBe('stale');
    expect(calls()).toBe(2);
  });

  it('serves the retained copy on server errors and network failures', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const url = feedUrl();
    countingFetch((call) => {
      if (call === 1) return response('<rss>kept</rss>');
      throw new Error('network unavailable');
    });

    await fetchFeedCached(url);
    vi.advanceTimersByTime(FEED_CACHE_TTL_MS + 1);
    const result = await fetchFeedCached(url);
    expect(result.response.status).toBe(200);
    expect(result.response.headers.get('X-Sift-Cache')).toBe('stale');
  });

  it('returns non-transient failures even when a copy is retained', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const url = feedUrl();
    countingFetch((call) => call === 1 ? response('<rss>kept</rss>') : new Response('gone', { status: 410 }));

    await fetchFeedCached(url);
    vi.advanceTimersByTime(FEED_CACHE_TTL_MS + 1);
    expect((await fetchFeedCached(url)).response.status).toBe(410);
    expect((await fetchFeedCached(url)).response.status).toBe(410);
  });

  it('stops serving the retained copy after the retention window', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const url = feedUrl();
    countingFetch((call) => call === 1
      ? response('<rss>kept</rss>')
      : new Response('limited', { status: 429, headers: { 'Retry-After': '60' } }));

    await fetchFeedCached(url);
    vi.advanceTimersByTime(FEED_CACHE_TTL_MS + FEED_STALE_RETENTION_MS + 1);
    const result = await fetchFeedCached(url);
    expect(result.response.status).toBe(429);
  });

  it('serves a Worker-cached retained copy during a shared cooldown after memory loss', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const url = feedUrl();
    const cache = testCache();
    vi.stubGlobal('caches', { default: cache });
    const calls = countingFetch((call) => call === 1
      ? response('<rss>worker</rss>')
      : new Response('limited', { status: 429, headers: { 'Retry-After': '600' } }));

    await fetchFeedCached(url);
    const stored = cache.entries.get(url);
    expect(stored?.headers.get('Cache-Control')).toBe(`public, max-age=${(FEED_CACHE_TTL_MS + FEED_STALE_RETENTION_MS) / 1000}`);
    vi.advanceTimersByTime(FEED_CACHE_TTL_MS + 1);
    await fetchFeedCached(url);
    clearFeedCacheForTests();
    clearOriginGovernorForTests();

    const result = await fetchFeedCached(url);
    expect(await result.response.text()).toBe('<rss>worker</rss>');
    expect(result.response.headers.get('X-Sift-Cache')).toBe('stale');
    expect(calls()).toBe(2);
  });

  it('treats Worker cache entries without freshness metadata as misses', async () => {
    const url = feedUrl();
    const cache = testCache();
    cache.entries.set(url, new Response('<rss>legacy</rss>', {
      headers: { 'X-Sift-Cache-Fetched-At': String(Date.now()) },
    }));
    vi.stubGlobal('caches', { default: cache });
    const calls = countingFetch(() => response('<rss>fresh</rss>'));

    const result = await fetchFeedCached(url);
    expect(await result.response.text()).toBe('<rss>fresh</rss>');
    expect(calls()).toBe(1);
  });
});
