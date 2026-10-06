import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Context } from 'hono';
import { createApp } from '../server/handle';
import { clearFeedCacheForTests } from '../server/fetch';
import * as governor from '../server/origin-governor';
import {
  PROXY_LIMITS,
  clearProxyLimitsForTests,
  normaliseClientIp,
  parseTrustedProxyHops,
  trustedProxyClientIp,
  type ProxyGuardOptions,
} from '../server/proxy-guard';
import { ARTICLE_MAX_BYTES, IMAGE_MAX_BYTES } from '../server/body-cap';

vi.mock('../server/origin-governor', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../server/origin-governor')>();
  return { ...actual, fetchOriginRequest: vi.fn(actual.fetchOriginRequest) };
});

const ORIGIN = 'http://93.184.216.34';
const PAGE_CSP = "default-src 'none'; sandbox";
const MIB = 1024 * 1024;

const ENDPOINTS = [
  { path: '/feed', csp: PAGE_CSP, type: 'application/xml' },
  { path: '/article', csp: PAGE_CSP, type: 'text/html' },
  { path: '/img', csp: 'sandbox', type: 'image/png' },
] as const;

function target(endpoint: string, upstream = `${ORIGIN}/resource`): string {
  return `${endpoint}?url=${encodeURIComponent(upstream)}`;
}

function stubUpstream(): ReturnType<typeof vi.fn> {
  const upstream = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    const type = url.includes('/img-') ? 'image/png' : 'text/html';
    return new Response('ok', { status: 200, headers: { 'Content-Type': type } });
  });
  vi.stubGlobal('fetch', upstream as unknown as typeof globalThis.fetch);
  return upstream;
}

function stubTyped(contentType: string): ReturnType<typeof vi.fn> {
  const upstream = vi.fn(async () => new Response('ok', { status: 200, headers: { 'Content-Type': contentType } }));
  vi.stubGlobal('fetch', upstream as unknown as typeof globalThis.fetch);
  return upstream;
}

function expectIsolated(response: Response, csp: string): void {
  expect(response.headers.get('Content-Security-Policy')).toBe(csp);
  expect(response.headers.get('X-Content-Type-Options')).toBe('nosniff');
}

function headerClient(c: Context): string | undefined {
  return c.req.header('x-test-ip');
}

function appWith(proxy: ProxyGuardOptions = {}) {
  return createApp({ proxy: { clientIp: headerClient, ...proxy } });
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.mocked(governor.fetchOriginRequest).mockClear();
  clearFeedCacheForTests();
  governor.clearOriginGovernorForTests();
  clearProxyLimitsForTests();
});

describe('same-site check', () => {
  it.each(ENDPOINTS)('accepts same-origin and none on $path', async ({ path, type }) => {
    stubTyped(type);
    for (const site of ['same-origin', 'none']) {
      governor.clearOriginGovernorForTests();
      const response = await appWith().request(target(path), { headers: { 'Sec-Fetch-Site': site } });
      expect(response.status, site).toBe(200);
    }
  });

  it.each(ENDPOINTS)('accepts requests without Sec-Fetch-Site on $path', async ({ path, type }) => {
    stubTyped(type);
    const response = await appWith().request(target(path));
    expect(response.status).toBe(200);
  });

  it.each(ENDPOINTS)('rejects other values on $path with isolation headers', async ({ path, csp, type }) => {
    const upstream = stubTyped(type);
    for (const site of ['cross-site', 'same-site', 'unexpected', '']) {
      const response = await appWith().request(target(path), { headers: { 'Sec-Fetch-Site': site } });
      expect(response.status, site).toBe(403);
      expect(response.headers.get('Cache-Control')).toBe('no-store');
      expect(response.headers.get('Content-Type')).toBe('text/plain; charset=utf-8');
      expect(response.headers.get('X-Sift-Request-Source')).toBe('same-site-check');
      expect(response.headers.get('Retry-After')).toBeNull();
      expectIsolated(response, csp);
    }
    expect(upstream).not.toHaveBeenCalled();
    expect(governor.fetchOriginRequest).not.toHaveBeenCalled();
  });

  it('rejects before validating the target', async () => {
    const upstream = stubUpstream();
    const response = await appWith().request('/feed?url=not-a-url', { headers: { 'Sec-Fetch-Site': 'cross-site' } });
    expect(response.status).toBe(403);
    expect(upstream).not.toHaveBeenCalled();
  });
});

describe('per-client limit', () => {
  const small = { limits: { fetch: { limit: 2, windowSeconds: 60 }, image: { limit: 2, windowSeconds: 60 } } };

  it('declares the default budgets', () => {
    expect(PROXY_LIMITS).toEqual({
      fetch: { limit: 2000, windowSeconds: 60 },
      image: { limit: 600, windowSeconds: 60 },
    });
  });

  it('enforces the default budgets', async () => {
    const app = createApp();
    for (let i = 0; i < PROXY_LIMITS.fetch.limit; i += 1) {
      expect((await app.request('/feed?url=bad')).status).toBe(400);
    }
    const limited = await app.request('/feed?url=bad');
    expect(limited.status).toBe(429);

    for (let i = 0; i < PROXY_LIMITS.image.limit; i += 1) {
      expect((await app.request('/img?url=bad')).status).toBe(400);
    }
    expect((await app.request('/img?url=bad')).status).toBe(429);
  });

  it.each(ENDPOINTS)('returns 429 with Retry-After and isolation headers on $path', async ({ path, csp, type }) => {
    const upstream = stubTyped(type);
    const app = appWith(small);
    const first = await app.request(target(path, `${ORIGIN}/a`), { headers: { 'x-test-ip': '198.51.100.1' } });
    expect(first.status).toBe(200);
    governor.clearOriginGovernorForTests();
    const second = await app.request(target(path, `${ORIGIN}/b`), { headers: { 'x-test-ip': '198.51.100.1' } });
    expect(second.status).toBe(200);
    const calls = upstream.mock.calls.length;

    const limited = await app.request(target(path, `${ORIGIN}/c`), { headers: { 'x-test-ip': '198.51.100.1' } });

    expect(limited.status).toBe(429);
    const retryAfter = Number(limited.headers.get('Retry-After'));
    expect(retryAfter).toBeGreaterThanOrEqual(1);
    expect(retryAfter).toBeLessThanOrEqual(60);
    expect(limited.headers.get('Cache-Control')).toBe('no-store');
    expect(limited.headers.get('X-Sift-Request-Source')).toBe('client-limit');
    expectIsolated(limited, csp);
    expect(upstream.mock.calls.length).toBe(calls);
  });

  it('recovers after the window', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(Date.UTC(2026, 0, 1, 0, 0, 10));
    const app = appWith(small);
    const headers = { 'x-test-ip': '198.51.100.2' };
    for (let i = 0; i < 2; i += 1) expect((await app.request('/feed?url=bad', { headers })).status).toBe(400);

    const limited = await app.request('/feed?url=bad', { headers });
    expect(limited.status).toBe(429);
    expect(limited.headers.get('Retry-After')).toBe('50');

    vi.setSystemTime(Date.UTC(2026, 0, 1, 0, 0, 59));
    expect((await app.request('/feed?url=bad', { headers })).status).toBe(429);

    vi.setSystemTime(Date.UTC(2026, 0, 1, 0, 1, 0));
    expect((await app.request('/feed?url=bad', { headers })).status).toBe(400);
  });

  it('keeps feed, article and image budgets as documented', async () => {
    const app = appWith(small);
    const headers = { 'x-test-ip': '198.51.100.3' };
    for (let i = 0; i < 2; i += 1) expect((await app.request('/img?url=bad', { headers })).status).toBe(400);
    expect((await app.request('/img?url=bad', { headers })).status).toBe(429);

    expect((await app.request('/feed?url=bad', { headers })).status).toBe(400);
    expect((await app.request('/article?url=bad', { headers })).status).toBe(400);
    expect((await app.request('/feed?url=bad', { headers })).status).toBe(429);
    expect((await app.request('/article?url=bad', { headers })).status).toBe(429);
  });

  it('limits clients independently', async () => {
    const app = appWith(small);
    for (let i = 0; i < 3; i += 1) await app.request('/feed?url=bad', { headers: { 'x-test-ip': '198.51.100.4' } });
    expect((await app.request('/feed?url=bad', { headers: { 'x-test-ip': '198.51.100.4' } })).status).toBe(429);
    expect((await app.request('/feed?url=bad', { headers: { 'x-test-ip': '198.51.100.5' } })).status).toBe(400);
  });

  it('shares one budget between IPv6 addresses in a /64', async () => {
    const app = appWith(small);
    await app.request('/feed?url=bad', { headers: { 'x-test-ip': '2001:db8:1:2::1' } });
    await app.request('/feed?url=bad', { headers: { 'x-test-ip': '2001:db8:1:2:ffff::9' } });
    expect((await app.request('/feed?url=bad', { headers: { 'x-test-ip': '2001:db8:1:2::77' } })).status).toBe(429);
    expect((await app.request('/feed?url=bad', { headers: { 'x-test-ip': '2001:db8:1:3::1' } })).status).toBe(400);
  });

  it('rejects before target validation, the governor and any upstream request', async () => {
    const upstream = stubTyped('text/html');
    const app = appWith({ limits: { fetch: { limit: 1, windowSeconds: 60 }, image: { limit: 1, windowSeconds: 60 } } });
    const hostTarget = 'http://news.example.test/story';

    expect((await app.request(target('/article', hostTarget))).status).toBe(400);
    expect(upstream).toHaveBeenCalled();
    const callsBefore = upstream.mock.calls.length;
    const governorBefore = vi.mocked(governor.fetchOriginRequest).mock.calls.length;

    const limited = await app.request(target('/article', hostTarget));

    expect(limited.status).toBe(429);
    expect(upstream.mock.calls.length).toBe(callsBefore);
    expect(vi.mocked(governor.fetchOriginRequest).mock.calls.length).toBe(governorBefore);
  });

  it('does not reach the governor for an over-budget request to a resolvable target', async () => {
    const upstream = stubTyped('text/html');
    const app = appWith({ limits: { fetch: { limit: 1, windowSeconds: 60 }, image: { limit: 1, windowSeconds: 60 } } });

    expect((await app.request(target('/article'))).status).toBe(200);
    expect(vi.mocked(governor.fetchOriginRequest)).toHaveBeenCalledTimes(1);
    expect(upstream).toHaveBeenCalledTimes(1);

    expect((await app.request(target('/article'))).status).toBe(429);
    expect((await app.request(target('/feed'))).status).toBe(429);
    expect(vi.mocked(governor.fetchOriginRequest)).toHaveBeenCalledTimes(1);
    expect(upstream).toHaveBeenCalledTimes(1);
  });

  it('counts responses served from the feed cache', async () => {
    const upstream = stubTyped('application/xml');
    const app = appWith({ limits: { fetch: { limit: 2, windowSeconds: 60 }, image: { limit: 2, windowSeconds: 60 } } });

    const first = await app.request(target('/feed'));
    const second = await app.request(target('/feed'));
    const third = await app.request(target('/feed'));

    expect([first.status, second.status, third.status]).toEqual([200, 200, 429]);
    expect(second.headers.get('X-Sift-Cache')).toBe('hit');
    expect(upstream).toHaveBeenCalledTimes(1);
  });

  it('records rejections without addresses or URLs', async () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => {});
    const app = appWith({ limits: { fetch: { limit: 1, windowSeconds: 60 }, image: { limit: 1, windowSeconds: 60 } } });
    const headers = { 'x-test-ip': '203.0.113.99' };
    await app.request(target('/feed', 'http://secret.example.test/private?token=abc'), { headers });
    await app.request(target('/feed', 'http://secret.example.test/private?token=abc'), { headers });
    await app.request(target('/feed', 'http://secret.example.test/private?token=abc'), {
      headers: { ...headers, 'Sec-Fetch-Site': 'cross-site' },
    });

    const lines = info.mock.calls.map((call) => String(call[0])).filter((line) => line.includes('client_rejected'));
    expect(lines).toHaveLength(2);
    const events = lines.map((line) => JSON.parse(line) as Record<string, unknown>);
    expect(events.map((event) => event.reason)).toEqual(['rate_limited', 'cross_site']);
    expect(events[0]).toMatchObject({
      event: 'upstream_policy.client_rejected',
      route: 'feed',
      status: 429,
      source: 'client-limit',
      limiter: 'local',
    });
    for (const line of lines) {
      expect(line).not.toContain('203.0.113.99');
      expect(line).not.toContain('secret.example');
      expect(line).not.toContain('token=abc');
    }
  });

  it('throttles repeated rejection diagnostics', async () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => {});
    const app = appWith();
    for (let i = 0; i < 5; i += 1) {
      await app.request('/feed?url=bad', { headers: { 'Sec-Fetch-Site': 'cross-site' } });
    }
    expect(info.mock.calls.filter((call) => String(call[0]).includes('client_rejected'))).toHaveLength(1);
  });
});

describe('Workers rate limiting binding', () => {
  function binding(success: boolean | Error) {
    return {
      limit: vi.fn(async (_options: { key: string }) => {
        if (success instanceof Error) throw success;
        return { success };
      }),
    };
  }

  it('uses the binding keyed by the client address and not the local limiter', async () => {
    const fetchLimiter = binding(true);
    const imageLimiter = binding(true);
    const app = createApp({
      proxy: {
        fetchLimiter,
        imageLimiter,
        clientIp: headerClient,
        limits: { fetch: { limit: 1, windowSeconds: 60 }, image: { limit: 1, windowSeconds: 60 } },
      },
    });
    const headers = { 'x-test-ip': '198.51.100.7' };

    for (let i = 0; i < 3; i += 1) expect((await app.request('/feed?url=bad', { headers })).status).toBe(400);
    for (let i = 0; i < 3; i += 1) expect((await app.request('/img?url=bad', { headers })).status).toBe(400);

    expect(fetchLimiter.limit).toHaveBeenCalledTimes(3);
    expect(fetchLimiter.limit).toHaveBeenCalledWith({ key: '198.51.100.7' });
    expect(imageLimiter.limit).toHaveBeenCalledTimes(3);
  });

  it('returns 429 with the period as Retry-After when the binding refuses', async () => {
    const upstream = stubTyped('text/html');
    const app = createApp({
      proxy: { fetchLimiter: binding(false), clientIp: headerClient },
    });

    const response = await app.request(target('/article'));

    expect(response.status).toBe(429);
    expect(response.headers.get('Retry-After')).toBe('60');
    expect(response.headers.get('X-Sift-Request-Source')).toBe('client-limit');
    expectIsolated(response, PAGE_CSP);
    expect(upstream).not.toHaveBeenCalled();
    expect(governor.fetchOriginRequest).not.toHaveBeenCalled();
  });

  it('falls back to the local limiter when the binding throws', async () => {
    const app = createApp({
      proxy: {
        fetchLimiter: binding(new Error('unavailable')),
        clientIp: headerClient,
        limits: { fetch: { limit: 1, windowSeconds: 60 }, image: { limit: 1, windowSeconds: 60 } },
      },
    });

    expect((await app.request('/feed?url=bad')).status).toBe(400);
    expect((await app.request('/feed?url=bad')).status).toBe(429);
  });

  it('works without any binding', async () => {
    stubTyped('text/html');
    const response = await createApp().request(target('/article'));
    expect(response.status).toBe(200);
  });
});

describe('client address', () => {
  it('normalises addresses', () => {
    expect(normaliseClientIp('203.0.113.9')).toBe('203.0.113.9');
    expect(normaliseClientIp('::ffff:203.0.113.9')).toBe('203.0.113.9');
    expect(normaliseClientIp('::ffff:cb00:7109')).toBe('203.0.113.9');
    expect(normaliseClientIp('[2001:DB8:1:2:3:4:5:6]')).toBe('v6:2001:db8:1:2');
    expect(normaliseClientIp('fe80::1%en0')).toBe('v6:fe80:0:0:0');
    expect(normaliseClientIp(undefined)).toBe('unknown');
    expect(normaliseClientIp('')).toBe('unknown');
    expect(normaliseClientIp('999.1.1.1')).toBe('unknown');
    expect(normaliseClientIp('not an address')).toBe('unknown');
  });

  it('parses the trusted proxy setting', () => {
    expect(parseTrustedProxyHops(undefined)).toBe(0);
    expect(parseTrustedProxyHops('')).toBe(0);
    expect(parseTrustedProxyHops('true')).toBe(0);
    expect(parseTrustedProxyHops('-1')).toBe(0);
    expect(parseTrustedProxyHops('1')).toBe(1);
    expect(parseTrustedProxyHops(' 2 ')).toBe(2);
  });

  async function resolve(hops: number, forwarded: string | undefined): Promise<string | undefined> {
    const resolver = trustedProxyClientIp(() => '192.0.2.1', hops);
    let result: string | undefined;
    const { Hono } = await import('hono');
    const app = new Hono();
    app.get('/', (c) => {
      result = resolver(c);
      return c.text('ok');
    });
    await app.request('/', { headers: forwarded === undefined ? {} : { 'X-Forwarded-For': forwarded } });
    return result;
  }

  it('ignores X-Forwarded-For unless a trusted proxy count is set', async () => {
    expect(await resolve(0, '203.0.113.50')).toBe('192.0.2.1');
  });

  it('takes the entry added by the trusted proxy, not one the client chose', async () => {
    expect(await resolve(1, '198.51.100.99, 203.0.113.50')).toBe('203.0.113.50');
    expect(await resolve(2, '198.51.100.99, 203.0.113.50, 10.0.0.1')).toBe('203.0.113.50');
  });

  it('falls back to the socket address when the header is short or invalid', async () => {
    expect(await resolve(1, undefined)).toBe('192.0.2.1');
    expect(await resolve(2, '203.0.113.50')).toBe('192.0.2.1');
    expect(await resolve(1, 'garbage')).toBe('192.0.2.1');
  });

  it('keys the limit on the socket address by default', async () => {
    const app = createApp({
      proxy: {
        clientIp: trustedProxyClientIp((c) => c.req.header('x-test-socket'), 0),
        limits: { fetch: { limit: 1, windowSeconds: 60 }, image: { limit: 1, windowSeconds: 60 } },
      },
    });
    const socket = { 'x-test-socket': '192.0.2.10' };
    expect((await app.request('/feed?url=bad', { headers: { ...socket, 'X-Forwarded-For': '203.0.113.1' } })).status).toBe(400);
    expect((await app.request('/feed?url=bad', { headers: { ...socket, 'X-Forwarded-For': '203.0.113.2' } })).status).toBe(429);
  });
});

describe('response body caps', () => {
  function streamOf(totalBytes: number, chunkBytes = MIB): { stream: ReadableStream<Uint8Array>; pulls: () => number } {
    let sent = 0;
    let pulls = 0;
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        pulls += 1;
        if (sent >= totalBytes) {
          controller.close();
          return;
        }
        const size = Math.min(chunkBytes, totalBytes - sent);
        sent += size;
        controller.enqueue(new Uint8Array(size));
      },
    });
    return { stream, pulls: () => pulls };
  }

  function stubStream(body: ReadableStream<Uint8Array>, headers: Record<string, string>) {
    vi.stubGlobal('fetch', (async () => new Response(body, { status: 200, headers })) as typeof globalThis.fetch);
  }

  async function byteLength(response: Response): Promise<number> {
    return (await response.arrayBuffer()).byteLength;
  }

  it.each([
    ['/article', ARTICLE_MAX_BYTES, 'text/html', PAGE_CSP],
    ['/img', IMAGE_MAX_BYTES, 'image/png', 'sandbox'],
  ] as const)('rejects a declared oversize %s before reading it', async (path, cap, type, csp) => {
    const { stream, pulls } = streamOf(cap + 1);
    stubStream(stream, { 'Content-Type': type, 'Content-Length': String(cap + 1) });

    const response = await appWith().request(target(path));

    expect(response.status).toBe(502);
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    expect(response.headers.get('X-Sift-Request-Source')).toBe('local-gate');
    expect(await response.text()).toBe('Upstream response is too large');
    expectIsolated(response, csp);
    expect(pulls()).toBeLessThan(cap / MIB);
  });

  it.each([
    ['/article', ARTICLE_MAX_BYTES, 'text/html'],
    ['/img', IMAGE_MAX_BYTES, 'image/png'],
  ] as const)('aborts a streamed oversize %s without reading it all', async (path, cap, type) => {
    const { stream, pulls } = streamOf(Number.MAX_SAFE_INTEGER);
    stubStream(stream, { 'Content-Type': type });

    const response = await appWith().request(target(path));

    expect(response.status).toBe(200);
    await expect(response.arrayBuffer()).rejects.toThrow();
    expect(pulls()).toBeLessThanOrEqual(cap / MIB + 6);
  });

  it.each([
    ['/article', ARTICLE_MAX_BYTES, 'text/html'],
    ['/img', IMAGE_MAX_BYTES, 'image/png'],
  ] as const)('aborts %s when the declared length understates the body', async (path, cap, type) => {
    const { stream } = streamOf(cap + MIB);
    stubStream(stream, { 'Content-Type': type, 'Content-Length': '10' });

    const response = await appWith().request(target(path));

    await expect(response.arrayBuffer()).rejects.toThrow();
  });

  it.each([
    ['/article', ARTICLE_MAX_BYTES, 'text/html'],
    ['/img', IMAGE_MAX_BYTES, 'image/png'],
  ] as const)('delivers a %s body of exactly the cap', async (path, cap, type) => {
    const { stream } = streamOf(cap);
    stubStream(stream, { 'Content-Type': type, 'Content-Length': String(cap) });

    const response = await appWith().request(target(path));

    expect(response.status).toBe(200);
    expect(await byteLength(response)).toBe(cap);
  });

  it('does not cap /feed bodies beyond the existing cache limit', async () => {
    const { stream } = streamOf(3 * MIB);
    stubStream(stream, { 'Content-Type': 'application/xml' });

    const response = await appWith().request(target('/feed'));

    expect(response.status).toBe(200);
    expect(await byteLength(response)).toBe(3 * MIB);
  });
});
