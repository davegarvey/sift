import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchOriginRequest, clearOriginGovernorForTests } from '../server/origin-governor';
import { fetchUpstreamWithPolicy } from '../server/fetch';
import { LocalD1Database } from '../server/sync/local-d1';
import { sha256Hex } from '../server/sync/tokens';
import { runSyncCron } from '../server/sync/cron';

const ORIGIN = 'http://93.184.216.34';

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  clearOriginGovernorForTests();
});

describe('shared upstream origin policy', () => {
  it('shares normalized origin spacing across routes through D1', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(100_000);
    const local = new LocalD1Database();
    const db = local as unknown as D1Database;
    const urls: string[] = [];
    vi.stubGlobal('fetch', (async (input) => {
      urls.push(String(input));
      return new Response('ok', { status: 200 });
    }) as typeof globalThis.fetch);

    const first = await fetchOriginRequest(`${ORIGIN}/one`, {}, { db, route: 'article' });
    expect(first.status).toBe(200);

    clearOriginGovernorForTests();
    const secondRequest = fetchOriginRequest(`${ORIGIN}:80/two`, {}, { db, route: 'image' });
    for (let i = 0; i < 50 && urls.length < 2; i += 1) await Promise.resolve();
    expect(urls).toEqual([`${ORIGIN}/one`]);
    await vi.advanceTimersByTimeAsync(1_000);
    const second = await secondRequest;

    expect(second.status).toBe(200);
    expect(urls).toEqual([`${ORIGIN}/one`, `${ORIGIN}:80/two`]);
    const rows = await local.prepare('SELECT * FROM upstream_origin_policy').all() as { results: Record<string, unknown>[] };
    expect(rows.results[0]).toMatchObject({ origin_key: await sha256Hex(ORIGIN) });
    expect(JSON.stringify(rows.results)).not.toContain(ORIGIN);
  });

  it('coalesces concurrent identical GET requests across matching routes', async () => {
    let calls = 0;
    vi.stubGlobal('fetch', (async () => {
      calls += 1;
      return new Response('shared body', { status: 200 });
    }) as typeof globalThis.fetch);

    const [article, image] = await Promise.all([
      fetchUpstreamWithPolicy(`${ORIGIN}/same`, {}, { route: 'article' }),
      fetchUpstreamWithPolicy(`${ORIGIN}/same`, {}, { route: 'image' }),
    ]);

    expect(calls).toBe(1);
    expect(await article.text()).toBe('shared body');
    expect(await image.text()).toBe('shared body');
  });

  it('shares 419 cooldown state across paths and emits the initial Retry-After', async () => {
    const local = new LocalD1Database();
    const db = local as unknown as D1Database;
    const diagnostic = vi.spyOn(console, 'info').mockImplementation(() => {});
    let calls = 0;
    vi.stubGlobal('fetch', (async () => {
      calls += 1;
      return new Response('private response body', { status: 419 });
    }) as typeof globalThis.fetch);

    const firstUrl = `${ORIGIN}/feed.xml?token=private-token`;
    const first = await fetchOriginRequest(firstUrl, {}, { db, route: 'feed' });
    expect(first.status).toBe(419);
    expect(first.headers.get('Retry-After')).toBe(String(6 * 60 * 60));
    expect(first.headers.get('X-Sift-Request-Source')).toBe('upstream');

    clearOriginGovernorForTests();
    const second = await fetchOriginRequest(`${ORIGIN}/article`, {}, { db, route: 'article' });
    expect(second.status).toBe(419);
    expect(second.headers.get('X-Sift-Request-Source')).toBe('origin-cooldown');
    expect(second.headers.get('Cache-Control')).toBe('no-store');
    expect(second.headers.get('Retry-After')).toBe(String(6 * 60 * 60));
    expect(calls).toBe(1);
    const logs = JSON.stringify(diagnostic.mock.calls);
    expect(logs).toContain('originHash');
    expect(logs).not.toContain(firstUrl);
    expect(logs).not.toContain('private-token');
    expect(logs).not.toContain('private response body');
  });

  it('progressively increases headerless 419 cooldowns in the runtime fallback', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000_000);
    let calls = 0;
    vi.stubGlobal('fetch', (async () => {
      calls += 1;
      return new Response('challenge', { status: 419 });
    }) as typeof globalThis.fetch);

    const first = await fetchOriginRequest(`${ORIGIN}/feed.xml`, {}, { route: 'feed' });
    expect(first.headers.get('Retry-After')).toBe(String(6 * 60 * 60));
    vi.advanceTimersByTime(6 * 60 * 60_000);
    const second = await fetchOriginRequest(`${ORIGIN}/article`, {}, { route: 'article' });
    expect(second.headers.get('Retry-After')).toBe(String(12 * 60 * 60));
    expect(calls).toBe(2);
  });

  it('rejects requests when the bounded runtime queue is full', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(2_000_000);
    const pending: Array<(response: Response) => void> = [];
    vi.stubGlobal('fetch', (() => new Promise<Response>((resolve) => pending.push(resolve))) as typeof globalThis.fetch);

    const requests = Array.from({ length: 21 }, (_, index) =>
      fetchOriginRequest(`${ORIGIN}/queue-${index}`, {}, { route: 'image' }));
    await vi.advanceTimersByTimeAsync(0);
    const rejected = await requests[20];

    expect(rejected.status).toBe(429);
    expect(rejected.headers.get('X-Sift-Request-Source')).toBe('local-gate');
    expect(rejected.headers.get('Retry-After')).toBe('5');
    expect(pending).toHaveLength(1);

    await vi.advanceTimersByTimeAsync(5_000);
    for (const resolve of pending) resolve(new Response('ok', { status: 200 }));
    await Promise.all(requests);
  });

  it('keeps active shared cooldown rows and removes old expired state', async () => {
    vi.useFakeTimers();
    const now = 50_000_000;
    vi.setSystemTime(now);
    const local = new LocalD1Database();
    const db = local as unknown as D1Database;
    vi.stubGlobal('fetch', (async () => new Response('challenge', {
      status: 419,
      headers: { 'Retry-After': String(2 * 60 * 60) },
    })) as typeof globalThis.fetch);
    await fetchOriginRequest(`${ORIGIN}/feed.xml`, {}, { db, route: 'feed' });

    await runSyncCron(db, now + 60 * 60_000);
    let rows = await local.prepare('SELECT * FROM upstream_origin_policy').all() as { results: Record<string, unknown>[] };
    expect(rows.results).toHaveLength(1);

    await runSyncCron(db, now + 8 * 24 * 60 * 60_000);
    rows = await local.prepare('SELECT * FROM upstream_origin_policy').all() as { results: Record<string, unknown>[] };
    expect(rows.results).toHaveLength(0);
  });
});
