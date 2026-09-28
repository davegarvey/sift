import 'fake-indexeddb/auto';
import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest';
import { convertV4MiniflareOptions, Miniflare } from 'miniflare';
import * as esbuild from 'esbuild';
import path from 'path';
import { getDb } from '../src/db/open';
import { upsertFeed } from '../src/db/feeds';
import { getItem, updateItem } from '../src/db/items';
import { getFeedStats } from '../src/db/stats';
import { setStoredSyncKey, setStoredLastSyncAt, getStoredLastItemsCursor, setStoredLastItemsCursor } from '../src/sync/key';
import { triggerFirstTime } from '../src/sync/init';
import { runPull, toServerItems } from '../src/sync/merge';
import { enqueueFlag, clearAllDirty } from '../src/sync/queue';
import { flushNow } from '../src/sync/push';
import { applyPollMigration } from './poll-db';

const FEED_URL = 'http://93.184.216.34/items-e2e.xml';

let workerCode: string;
let mf: Miniflare;
let feedRequests = 0;

beforeAll(async () => {
  const result = await esbuild.build({
    entryPoints: [path.resolve(__dirname, '../server/sync/test-poll-worker.ts')],
    bundle: true,
    format: 'esm',
    platform: 'neutral',
    mainFields: ['module', 'main'],
    write: false,
  });
  workerCode = result.outputFiles[0].text;
}, 15_000);

const body = `<?xml version="1.0"?><rss version="2.0"><channel><title>Feed</title>
  <item><guid>one</guid><title>One</title><link>http://93.184.216.34/one</link><pubDate>Mon, 01 Jan 2024 00:00:00 GMT</pubDate><description>First</description></item>
  <item><guid>two</guid><title>Two</title><link>http://93.184.216.34/two</link><description>Undated</description></item>
</channel></rss>`;

beforeEach(async () => {
  feedRequests = 0;
  mf = new Miniflare(convertV4MiniflareOptions({
    modules: true,
    script: workerCode,
    d1Databases: ['DB', 'POLL_DB'],
    bindings: { FEED_POLLING: 'true' },
    outboundService: () => {
      feedRequests += 1;
      return new Response(body);
    },
  }));
  await mf.ready;
  await applyPollMigration(mf, { maintainedAt: Date.now() });
  await clearLocal();
  clearAllDirty();
});

afterEach(async () => {
  await mf.dispose();
});

async function clearLocal(): Promise<void> {
  const db = await getDb();
  for (const store of ['feeds', 'items', 'itemFlags', 'meta', 'feedStats', 'readMarkers'] as const) {
    if (db.objectStoreNames.contains(store)) await db.clear(store);
  }
}

async function withMfFetch<T>(fn: () => Promise<T>): Promise<T> {
  const original = globalThis.fetch;
  globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
    const raw = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const url = raw.startsWith('http') ? raw : `http://localhost${raw}`;
    return (mf as any).dispatchFetch(url, init); // why: Miniflare types don't expose dispatchFetch on the main type
  }) as unknown as typeof globalThis.fetch; // why: wrapping dispatchFetch to match fetch signature
  try {
    return await fn();
  } finally {
    globalThis.fetch = original;
  }
}

async function poll(): Promise<void> {
  const worker = await mf.getWorker();
  await worker.scheduled({ cron: '*/10 * * * *', scheduledTime: new Date() });
}

describe('server-polled item sync', () => {
  it('delivers items polled while the device was away, preserving synced flags', async () => {
    const key = 'itemsE2Exxxxxxxxxxxxxx';
    const feedId = crypto.randomUUID();
    await upsertFeed({ id: feedId, url: FEED_URL, title: 'Feed', learnedIntervalMs: 3_600_000, lastFetched: null });
    await setStoredSyncKey(key);
    await setStoredLastSyncAt(null);
    await withMfFetch(async () => {
      await triggerFirstTime();
      enqueueFlag({ itemId: `${feedId}::one`, feedId, read: 1, readAt: Date.now(), starred: null, starredAt: Date.now() });
      await flushNow();
    });

    await poll();
    expect(feedRequests).toBe(1);

    await clearLocal();
    await setStoredSyncKey(key);
    await setStoredLastSyncAt(null);
    await withMfFetch(() => triggerFirstTime());

    const one = await getItem(`${feedId}::one`);
    const two = await getItem(`${feedId}::two`);
    expect(one?.title).toBe('One');
    expect(one?.read).toBe(true);
    expect(one?.publishedAt).toBe(Date.parse('2024-01-01T00:00:00Z'));
    expect(two?.read).toBe(false);
    expect(two?.dateFallback).toBe(true);
    expect(two?.publishedAt).toBe(two?.createdAt);
    expect((await getFeedStats(feedId))?.totalSeen).toBe(2);
    expect(await getStoredLastItemsCursor()).toBeGreaterThan(0);
  });

  it('never overwrites an item the device already holds', async () => {
    const key = 'itemsKeepxxxxxxxxxxxxx';
    const feedId = crypto.randomUUID();
    await upsertFeed({ id: feedId, url: FEED_URL, title: 'Feed', learnedIntervalMs: 3_600_000, lastFetched: null });
    await setStoredSyncKey(key);
    await setStoredLastSyncAt(null);
    await withMfFetch(() => triggerFirstTime());
    await poll();
    await withMfFetch(() => runPull());
    await updateItem(`${feedId}::one`, { title: 'Local copy', html: '<p>local</p>' });

    await setStoredLastItemsCursor(0);
    await withMfFetch(() => runPull());
    const one = await getItem(`${feedId}::one`);
    expect(one?.title).toBe('Local copy');
    expect(one?.html).toBe('<p>local</p>');
  });
});

describe('toServerItems', () => {
  it('skips rows for unknown feeds and malformed rows', () => {
    const rows = [
      { seq: 1, feed_id: 'known', guid: 'g', title: 'T', link: null, author: null, published_at: null, excerpt: 'e', html: null, thumbnail: null, first_seen_at: 500 },
      { seq: 2, feed_id: 'unknown', guid: 'g', title: 'T', first_seen_at: 500 },
      { seq: 3, feed_id: 'known', title: 'no guid', first_seen_at: 500 },
      null,
    ];
    const items = toServerItems(rows, new Set(['known']));
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      id: 'known::g',
      feedId: 'known',
      publishedAt: 500,
      createdAt: 500,
      dateFallback: true,
      thumbnail: null,
      read: false,
    });
    expect(items[0].html).toBeUndefined();
  });
});
