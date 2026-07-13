import 'fake-indexeddb/auto';
import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest';
import { Miniflare } from 'miniflare';
import * as esbuild from 'esbuild';
import path from 'path';
import { getDb } from '../src/db/open';
import { upsertFeed } from '../src/db/feeds';
import { setFlag } from '../src/db/flags';
import { setStoredSyncKey, setStoredLastSyncAt } from '../src/sync/key';
import { triggerFirstTime } from '../src/sync/init';
import { setMeta } from '../src/db/meta';

let workerCode: string;

beforeAll(async () => {
  const result = await esbuild.build({
    entryPoints: [path.resolve(__dirname, '../server/sync/test-worker.ts')],
    bundle: true,
    format: 'esm',
    platform: 'neutral',
    write: false,
  });
  workerCode = result.outputFiles[0].text;
}, 15_000);

let mf: Miniflare;

beforeEach(async () => {
  mf = new Miniflare({
    modules: true,
    script: workerCode,
    d1Databases: ['DB'],
  });
  await mf.ready;

  const db = await getDb();
  for (const store of ['feeds', 'items', 'itemFlags', 'meta'] as const) {
    if (db.objectStoreNames.contains(store)) {
      await db.clear(store);
    }
  }
});

afterEach(async () => {
  await mf.dispose();
});

function makeSyncKey(label: string): string {
  const raw = label + 'xxxxxxxxxxxxxxxxxxxx';
  return raw.slice(0, 22).replace(/[^A-Za-z0-9_-]/g, 'x');
}

async function withMfFetch<T>(fn: () => Promise<T>): Promise<T> {
  const original = globalThis.fetch;
  globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
    let url: string;
    if (typeof input === 'string') {
      url = input.startsWith('http') ? input : `http://localhost${input}`;
    } else if (input instanceof URL) {
      url = input.href;
    } else {
      url = (input as Request).url.startsWith('http')
        ? (input as Request).url
        : `http://localhost${(input as Request).url}`;
    }
    return (mf as any).dispatchFetch(url, init);
  }) as unknown as typeof globalThis.fetch;
  try {
    return await fn();
  } finally {
    globalThis.fetch = original;
  }
}

describe('sync pairing first-time setup', () => {
  it('pushes pre-existing feeds when enabling sync', async () => {
    const key = makeSyncKey('test-1---');

    // Simulate user who has been using Sift: 2 feeds + 1 flag already in IndexedDB
    await upsertFeed({
      url: 'https://ex.com/a',
      title: 'Feed A',
      learnedIntervalMs: 3_600_000,
      lastFetched: null,
    });
    await upsertFeed({
      url: 'https://ex.com/b',
      title: 'Feed B',
      folder: ['Tech'],
      learnedIntervalMs: 3_600_000,
      lastFetched: null,
    });
    await setFlag({
      id: 'https://ex.com/a::p1',
      feedUrl: 'https://ex.com/a',
      read: 1,
      starred: 0,
    });

    await setStoredSyncKey(key);
    await setStoredLastSyncAt(null);

    await withMfFetch(() => triggerFirstTime());

    const pullRes = await mf.dispatchFetch(
      'http://localhost/sync/pull?since=0',
      { headers: { 'X-Sync-Key': key } },
    );
    expect(pullRes.status).toBe(200);
    const pull = (await pullRes.json()) as {
      feeds: Array<Record<string, unknown>>;
      flags: Array<Record<string, unknown>>;
    };

    expect(pull.feeds.length).toBe(2);
    expect(pull.flags.length).toBe(1);
  });

  it('works when enabling sync before any subscriptions', async () => {
    const key = makeSyncKey('test-2---');
    await setStoredSyncKey(key);
    await setStoredLastSyncAt(null);

    await withMfFetch(() => triggerFirstTime());

    const pullRes = await mf.dispatchFetch(
      'http://localhost/sync/pull?since=0',
      { headers: { 'X-Sync-Key': key } },
    );
    expect(pullRes.status).toBe(200);
    const pull = (await pullRes.json()) as {
      feeds: Array<Record<string, unknown>>;
      flags: Array<Record<string, unknown>>;
    };
    expect(pull.feeds.length).toBe(0);
    expect(pull.flags.length).toBe(0);
  });

  it('re-pushes feeds after disable and re-enable', async () => {
    // --- First enable: subscribe feed A, enable sync ---
    const key1 = makeSyncKey('disable-1');
    await setStoredSyncKey(key1);
    await setStoredLastSyncAt(null);
    await upsertFeed({
      url: 'https://ex.com/a',
      title: 'Feed A',
      learnedIntervalMs: 3_600_000,
      lastFetched: null,
    });

    await withMfFetch(() => triggerFirstTime());

    let pullRes = await mf.dispatchFetch(
      'http://localhost/sync/pull?since=0',
      { headers: { 'X-Sync-Key': key1 } },
    );
    let pull = (await pullRes.json()) as { feeds: Array<Record<string, unknown>> };
    expect(pull.feeds.length).toBe(1);

    // --- Disable: clear sync settings (simulating disableSync) ---
    await setMeta('settings', { syncKey: null, lastSyncAt: null });

    // Add feed B while sync is disabled
    await upsertFeed({
      url: 'https://ex.com/b',
      title: 'Feed B',
      learnedIntervalMs: 3_600_000,
      lastFetched: null,
    });

    // --- Re-enable with a fresh key ---
    const key2 = makeSyncKey('disable-2');
    await setStoredSyncKey(key2);
    await setStoredLastSyncAt(null);

    await withMfFetch(() => triggerFirstTime());

    // Both feeds should be on the server under the new key
    pullRes = await mf.dispatchFetch(
      'http://localhost/sync/pull?since=0',
      { headers: { 'X-Sync-Key': key2 } },
    );
    pull = (await pullRes.json()) as { feeds: Array<Record<string, unknown>> };
    expect(pull.feeds.length).toBe(2);

    // Old key still has original feed (orphaned — expected)
    pullRes = await mf.dispatchFetch(
      'http://localhost/sync/pull?since=0',
      { headers: { 'X-Sync-Key': key1 } },
    );
    pull = (await pullRes.json()) as { feeds: Array<Record<string, unknown>> };
    expect(pull.feeds.length).toBe(1);
  });

  it('pushes local feeds during pairing', async () => {
    // --- "Desktop" device: has a feed, enables sync ---
    const deskKey = makeSyncKey('pair-desk');
    await setStoredSyncKey(deskKey);
    await setStoredLastSyncAt(null);
    await upsertFeed({
      url: 'https://ex.com/desk',
      title: 'Desktop Feed',
      learnedIntervalMs: 3_600_000,
      lastFetched: null,
    });

    await withMfFetch(() => triggerFirstTime());

    // Verify desktop's feed is on server
    let pullRes = await mf.dispatchFetch(
      'http://localhost/sync/pull?since=0',
      { headers: { 'X-Sync-Key': deskKey } },
    );
    let pull = (await pullRes.json()) as { feeds: Array<Record<string, unknown>> };
    expect(pull.feeds.length).toBe(1);

    // Generate pairing code (as desktop)
    const otpRes = await mf.dispatchFetch('http://localhost/sync/otp', {
      method: 'POST',
      headers: { 'X-Sync-Key': deskKey },
    });
    const { code } = (await otpRes.json()) as { code: string };

    // Redeem code (as mobile)
    const redeemRes = await mf.dispatchFetch('http://localhost/sync/redeem', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code }),
    });
    const { syncKey: mobileKey } = (await redeemRes.json()) as { syncKey: string };

    // --- "Mobile" device: fresh local state, has a different feed ---
    const db = await getDb();
    for (const store of ['feeds', 'items', 'itemFlags', 'meta'] as const) {
      if (db.objectStoreNames.contains(store)) {
        await db.clear(store);
      }
    }

    await upsertFeed({
      url: 'https://ex.com/mobile',
      title: 'Mobile Feed',
      learnedIntervalMs: 3_600_000,
      lastFetched: null,
    });

    // Mobile pairs with the redeemed key
    await setStoredSyncKey(mobileKey);
    await setStoredLastSyncAt(null);

    await withMfFetch(() => triggerFirstTime());

    // Pull should have both the desktop's and mobile's feeds
    pullRes = await mf.dispatchFetch(
      'http://localhost/sync/pull?since=0',
      { headers: { 'X-Sync-Key': mobileKey } },
    );
    pull = (await pullRes.json()) as { feeds: Array<{ feed_url: string }> };
    const urls = pull.feeds.map((f) => f.feed_url).sort();
    expect(urls).toEqual(['https://ex.com/desk', 'https://ex.com/mobile']);
  });
});
