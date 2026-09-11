import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchUpstream } from '../server/fetch';

const PUBLIC_ORIGIN = 'http://93.184.216.34';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('fetchUpstream redirects', () => {
  it('follows public HTTP-to-HTTPS redirects and forces manual mode', async () => {
    const requests: string[] = [];
    const redirectModes: unknown[] = [];
    vi.stubGlobal('fetch', (async (input, init) => {
      requests.push(String(input));
      redirectModes.push(init?.redirect);
      if (requests.length === 1) {
        return new Response(null, {
          status: 301,
          headers: { Location: `${PUBLIC_ORIGIN.replace('http:', 'https:')}/feed.xml` },
        });
      }
      return new Response('final feed', { status: 200 });
    }) as typeof globalThis.fetch);

    const response = await fetchUpstream(`${PUBLIC_ORIGIN}/start`);

    expect(response.status).toBe(200);
    expect(await response.text()).toBe('final feed');
    expect(requests).toEqual([`${PUBLIC_ORIGIN}/start`, 'https://93.184.216.34/feed.xml']);
    expect(redirectModes).toEqual(['manual', 'manual']);
  });

  it('follows a relative public redirect', async () => {
    const requests: string[] = [];
    vi.stubGlobal('fetch', (async (input) => {
      requests.push(String(input));
      return requests.length === 1
        ? new Response(null, { status: 302, headers: { Location: '/final' } })
        : new Response('final', { status: 200 });
    }) as typeof globalThis.fetch);

    await expect(fetchUpstream(`${PUBLIC_ORIGIN}/start`)).resolves.toMatchObject({ status: 200 });
    expect(requests).toEqual([`${PUBLIC_ORIGIN}/start`, `${PUBLIC_ORIGIN}/final`]);
  });

  it('blocks a private redirect before requesting its destination', async () => {
    const requests: string[] = [];
    vi.stubGlobal('fetch', (async (input) => {
      requests.push(String(input));
      return new Response(null, { status: 302, headers: { Location: 'http://127.0.0.1/admin' } });
    }) as typeof globalThis.fetch);

    await expect(fetchUpstream(`${PUBLIC_ORIGIN}/start`)).rejects.toThrow('Unsafe upstream redirect');
    expect(requests).toEqual([`${PUBLIC_ORIGIN}/start`]);
  });

  it('blocks redirects without a location', async () => {
    const requests: string[] = [];
    vi.stubGlobal('fetch', (async (input) => {
      requests.push(String(input));
      return new Response(null, { status: 307 });
    }) as typeof globalThis.fetch);

    await expect(fetchUpstream(`${PUBLIC_ORIGIN}/start`)).rejects.toThrow('no location');
    expect(requests).toHaveLength(1);
  });

  it('blocks non-HTTP and malformed redirect locations', async () => {
    for (const location of ['javascript:alert(1)', 'http://[invalid']) {
      const requests: string[] = [];
      vi.stubGlobal('fetch', (async (input) => {
        requests.push(String(input));
        return new Response(null, { status: 302, headers: { Location: location } });
      }) as typeof globalThis.fetch);

      await expect(fetchUpstream(`${PUBLIC_ORIGIN}/start`)).rejects.toThrow();
      expect(requests).toEqual([`${PUBLIC_ORIGIN}/start`]);
    }
  });

  it('blocks unsupported redirect statuses', async () => {
    const requests: string[] = [];
    vi.stubGlobal('fetch', (async (input) => {
      requests.push(String(input));
      return new Response(null, { status: 300, headers: { Location: '/final' } });
    }) as typeof globalThis.fetch);

    await expect(fetchUpstream(`${PUBLIC_ORIGIN}/start`)).rejects.toThrow('Unsafe or excessive upstream redirect');
    expect(requests).toHaveLength(1);
  });

  it('bounds redirect loops', async () => {
    const requests: string[] = [];
    vi.stubGlobal('fetch', (async (input) => {
      requests.push(String(input));
      return new Response(null, { status: 308, headers: { Location: '/again' } });
    }) as typeof globalThis.fetch);

    await expect(fetchUpstream(`${PUBLIC_ORIGIN}/start`)).rejects.toThrow('excessive upstream redirect');
    expect(requests).toHaveLength(6);
  });
});
