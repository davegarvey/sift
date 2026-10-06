import { afterEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../server/handle';
import { clearFeedCacheForTests } from '../server/fetch';
import { clearOriginGovernorForTests } from '../server/origin-governor';

const PUBLIC_ORIGIN = 'http://93.184.216.34';

afterEach(() => {
  vi.unstubAllGlobals();
  clearFeedCacheForTests();
  clearOriginGovernorForTests();
});

describe('upstream proxy redirect boundary', () => {
  it('returns a generic failure for a private redirect without exposing it', async () => {
    const requests: string[] = [];
    vi.stubGlobal('fetch', (async (input) => {
      requests.push(String(input));
      return new Response(null, {
        status: 302,
        headers: { Location: 'http://127.0.0.1/admin' },
      });
    }) as typeof globalThis.fetch);

    const app = createApp();
    const response = await app.request(`/feed?url=${encodeURIComponent(`${PUBLIC_ORIGIN}/feed.xml`)}`);

    expect(response.status).toBe(502);
    expect(response.headers.get('Location')).toBeNull();
    expect(response.headers.get('Refresh')).toBeNull();
    expect(requests).toEqual([`${PUBLIC_ORIGIN}/feed.xml`]);
  });

  it('removes redirect headers from upstream error responses', async () => {
    vi.stubGlobal('fetch', (async () => new Response('upstream error', {
      status: 419,
      headers: {
        Location: 'http://127.0.0.1/admin',
        Refresh: '0; url=http://127.0.0.1/admin',
        'Content-Location': 'http://127.0.0.1/admin',
      },
    })) as typeof globalThis.fetch);

    for (const endpoint of ['/feed', '/article', '/img']) {
      const url = `${PUBLIC_ORIGIN}${endpoint}.xml`;
      const response = await createApp().request(`${endpoint}?url=${encodeURIComponent(url)}`);
      expect(response.status).toBe(419);
      expect(response.headers.get('Cache-Control')).toBe('no-store');
      expect(response.headers.get('Retry-After')).toBe(String(6 * 60 * 60));
      expect(response.headers.get('Location')).toBeNull();
      expect(response.headers.get('Refresh')).toBeNull();
      expect(response.headers.get('Content-Location')).toBeNull();
      expect(response.headers.get('X-Sift-Request-Source')).toBe(endpoint === '/feed' ? 'upstream' : 'origin-cooldown');
    }
  });

  it('applies immutable caching to successful images only', async () => {
    vi.stubGlobal('fetch', (async () => new Response('image', {
      status: 200,
      headers: { 'Content-Type': 'image/png' },
    })) as typeof globalThis.fetch);

    const response = await createApp().request(`/img?url=${encodeURIComponent(`${PUBLIC_ORIGIN}/image.png`)}`);

    expect(response.status).toBe(200);
    expect(response.headers.get('Cache-Control')).toBe('public, max-age=2592000, immutable');
    expect(response.headers.get('X-Sift-Request-Source')).toBe('upstream');
  });
});

describe('upstream proxy response isolation', () => {
  const PAGE_CSP = "default-src 'none'; sandbox";

  function proxied(endpoint: string, path: string): string {
    return `${endpoint}?url=${encodeURIComponent(`${PUBLIC_ORIGIN}${path}`)}`;
  }

  function expectIsolated(response: Response, csp: string): void {
    expect(response.headers.get('Content-Security-Policy')).toBe(csp);
    expect(response.headers.get('X-Content-Type-Options')).toBe('nosniff');
  }

  it('sandboxes successful feed and article responses', async () => {
    vi.stubGlobal('fetch', (async () => new Response('<html><script>alert(1)</script></html>', {
      status: 200,
      headers: { 'Content-Type': 'text/html' },
    })) as typeof globalThis.fetch);

    const feed = await createApp().request(proxied('/feed', '/feed.xml'));
    expect(feed.status).toBe(200);
    expectIsolated(feed, PAGE_CSP);

    const article = await createApp().request(proxied('/article', '/page.html'));
    expect(article.status).toBe(200);
    expect(article.headers.get('Content-Type')).toBe('text/html; charset=utf-8');
    expectIsolated(article, PAGE_CSP);
  });

  it('sandboxes successful image responses', async () => {
    vi.stubGlobal('fetch', (async () => new Response('<svg xmlns="http://www.w3.org/2000/svg"/>', {
      status: 200,
      headers: { 'Content-Type': 'image/svg+xml' },
    })) as typeof globalThis.fetch);

    const response = await createApp().request(proxied('/img', '/image.svg'));

    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Type')).toBe('image/svg+xml');
    expectIsolated(response, 'sandbox');
  });

  it.each([
    ['HTML', { 'Content-Type': 'text/html' }],
    ['binary', { 'Content-Type': 'application/octet-stream' }],
    ['untyped', {}],
  ])('refuses %s image responses', async (_label, headers: Record<string, string>) => {
    const body = new TextEncoder().encode('<script>alert(1)</script>');
    vi.stubGlobal('fetch', (async () => new Response(body, { status: 200, headers })) as typeof globalThis.fetch);

    const response = await createApp().request(proxied('/img', '/image.png'));

    expect(response.status).toBe(502);
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    expect(await response.text()).toBe('Upstream response is not an image');
    expectIsolated(response, 'sandbox');
  });

  it('does not forward upstream content headers on error responses', async () => {
    vi.stubGlobal('fetch', (async () => new Response('<script>alert(1)</script>', {
      status: 404,
      headers: { 'Content-Type': 'text/html', 'Set-Cookie': 'session=attacker' },
    })) as typeof globalThis.fetch);

    for (const [endpoint, csp] of [['/feed', PAGE_CSP], ['/article', PAGE_CSP], ['/img', 'sandbox']] as const) {
      const response = await createApp().request(proxied(endpoint, `${endpoint}-missing`));
      expect(response.status).toBe(404);
      expect(response.headers.get('Content-Type')).toBe('text/plain; charset=utf-8');
      expect(response.headers.get('Set-Cookie')).toBeNull();
      expectIsolated(response, csp);
    }
  });

  it('sandboxes locally generated failures', async () => {
    const response = await createApp().request('/article?url=not-a-url');

    expect(response.status).toBe(400);
    expectIsolated(response, PAGE_CSP);
  });
});
