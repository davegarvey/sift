/**
 * fetchFeed Retry-After parsing: 429s carry an optional retryAfterMs;
 * every other status ignores the header. Non-numeric values never NaN.
 */

import { describe, it, expect } from 'vitest';
import { fetchFeed } from '../src/feeds/fetch';

function stubFetch(status: number, headers: Record<string, string> = {}): void {
  globalThis.fetch = (async () =>
    new Response('', { status, headers })) as unknown as typeof globalThis.fetch;
}

describe('fetchFeed Retry-After parsing', () => {
  it('parses integer seconds on a 429', async () => {
    stubFetch(429, { 'Retry-After': '3600' });
    const result = await fetchFeed('https://x.example/feed.xml');
    expect(result.kind).toBe('error');
    if (result.kind === 'error') {
      expect(result.retryAfterMs).toBe(3_600_000);
    }
  });

  it('treats Retry-After 0 as valid (retry next tick)', async () => {
    stubFetch(429, { 'Retry-After': '0' });
    const result = await fetchFeed('https://x.example/feed.xml');
    if (result.kind === 'error') {
      expect(result.retryAfterMs).toBe(0);
    }
  });

  it('parses an HTTP-date Retry-After', async () => {
    const date = new Date(Date.now() + 10_000);
    stubFetch(429, { 'Retry-After': date.toUTCString() });
    const result = await fetchFeed('https://x.example/feed.xml');
    if (result.kind === 'error') {
      expect(result.retryAfterMs).toBeGreaterThan(9_000);
      expect(result.retryAfterMs).toBeLessThan(11_000);
    }
  });

  it('falls back to absent when Retry-After is unparseable', async () => {
    stubFetch(429, { 'Retry-After': 'garbage-not-a-date' });
    const result = await fetchFeed('https://x.example/feed.xml');
    if (result.kind === 'error') {
      expect(result.retryAfterMs).toBeUndefined();
      expect(Number.isNaN(result.retryAfterMs)).toBe(false);
    }
  });

  it('falls back to absent when Retry-After is missing', async () => {
    stubFetch(429);
    const result = await fetchFeed('https://x.example/feed.xml');
    if (result.kind === 'error') {
      expect(result.retryAfterMs).toBeUndefined();
    }
  });

  it('ignores Retry-After on non-429 statuses', async () => {
    stubFetch(503, { 'Retry-After': '3600' });
    const result = await fetchFeed('https://x.example/feed.xml');
    if (result.kind === 'error') {
      expect(result.status).toBe(503);
      expect(result.retryAfterMs).toBeUndefined();
    }
  });

  it('returns a modified body with etag on 200', async () => {
    globalThis.fetch = (async () =>
      new Response('<rss/>', { status: 200, headers: { ETag: '"abc"' } })) as unknown as typeof globalThis.fetch;
    const result = await fetchFeed('https://x.example/feed.xml');
    expect(result.kind).toBe('modified');
    if (result.kind === 'modified') {
      expect(result.body).toBe('<rss/>');
      expect(result.etag).toBe('"abc"');
    }
  });
});
