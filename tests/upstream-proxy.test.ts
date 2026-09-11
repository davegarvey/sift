import { afterEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../server/handle';
import { clearFeedCacheForTests } from '../server/fetch';

const PUBLIC_ORIGIN = 'http://93.184.216.34';

afterEach(() => {
  vi.unstubAllGlobals();
  clearFeedCacheForTests();
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
      expect(response.headers.get('Location')).toBeNull();
      expect(response.headers.get('Refresh')).toBeNull();
      expect(response.headers.get('Content-Location')).toBeNull();
    }
  });
});
