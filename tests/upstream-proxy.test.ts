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
