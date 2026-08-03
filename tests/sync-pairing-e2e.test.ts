import 'fake-indexeddb/auto';
import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest';
import { Miniflare } from 'miniflare';
import * as esbuild from 'esbuild';
import path from 'path';
import { getDb } from '../src/db/open';
import { upsertFeed, listFeeds } from '../src/db/feeds';
import { setFlag } from '../src/db/flags';
import { setStoredSyncKey, setStoredLastSyncAt, clearStoredSyncKey } from '../src/sync/key';
import { triggerFirstTime } from '../src/sync/init';
import { clearAllDirty, enqueueFlag } from '../src/sync/queue';
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

  // Reset server-side D1 state between tests (Miniflare may reuse a
  // persistent SQLite file across instances, so we drop explicitly).
  const d1 = await mf.getD1Database('DB');
  await d1.prepare('DROP TABLE IF EXISTS feeds').run();
  await d1.prepare('DROP TABLE IF EXISTS flags').run();

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
    return (mf as any).dispatchFetch(url, init); // why: Miniflare types don't expose dispatchFetch on the main type
  }) as unknown as typeof globalThis.fetch; // why: wrapping dispatchFetch to match fetch signature
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
      id: crypto.randomUUID(),
      url: 'https://ex.com/a',
      title: 'Feed A',
      learnedIntervalMs: 3_600_000,
      lastFetched: null,
    });
    await upsertFeed({
      id: crypto.randomUUID(),
      url: 'https://ex.com/b',
      title: 'Feed B',
      folder: ['Tech'],
      learnedIntervalMs: 3_600_000,
      lastFetched: null,
    });
    await setFlag({
      id: 'https://ex.com/a::p1',
      feedId: 'https://ex.com/a',
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

  it('re-enable with a fresh key uploads local feeds', async () => {
    // --- First enable: subscribe feed A, enable sync ---
    const key1 = makeSyncKey('disable-1');
    await setStoredSyncKey(key1);
    await setStoredLastSyncAt(null);
    await upsertFeed({
      id: crypto.randomUUID(),
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
      id: crypto.randomUUID(),
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
    const deskFeedId = crypto.randomUUID();
    await setStoredSyncKey(deskKey);
    await setStoredLastSyncAt(null);
    await upsertFeed({
      id: deskFeedId,
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

    const mobileFeedId = crypto.randomUUID();
    await upsertFeed({
      id: mobileFeedId,
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
    pull = (await pullRes.json()) as { feeds: Array<{ feed_url: string; feed_id: string }> };
    const ids = pull.feeds.map((f) => f.feed_id).sort();
    expect(ids).toEqual([deskFeedId, mobileFeedId].sort());
  });

  it('deduplicates feeds with same URL when pairing', async () => {
    // --- "Desktop" device: has a feed, enables sync ---
    const deskKey = makeSyncKey('dedup-desk');
    const sharedUrl = 'https://ex.com/shared';
    const deskFeedId = crypto.randomUUID();
    await setStoredSyncKey(deskKey);
    await setStoredLastSyncAt(null);
    await upsertFeed({
      id: deskFeedId,
      url: sharedUrl,
      title: 'Shared Feed',
      learnedIntervalMs: 3_600_000,
      lastFetched: null,
    });

    await withMfFetch(() => triggerFirstTime());

    const pullRes = await mf.dispatchFetch(
      'http://localhost/sync/pull?since=0',
      { headers: { 'X-Sync-Key': deskKey } },
    );
    expect(pullRes.status).toBe(200);
    const pull = (await pullRes.json()) as { feeds: Array<Record<string, unknown>> };
    expect(pull.feeds.length).toBe(1);

    // Desktop generates pairing code
    const otpRes = await mf.dispatchFetch('http://localhost/sync/otp', {
      method: 'POST',
      headers: { 'X-Sync-Key': deskKey },
    });
    const { code } = (await otpRes.json()) as { code: string };

    // Mobile redeems code
    const redeemRes = await mf.dispatchFetch('http://localhost/sync/redeem', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code }),
    });
    const { syncKey: mobileKey } = (await redeemRes.json()) as { syncKey: string };

    // --- "Mobile" device: fresh local state with the SAME feed URL but different UUID ---
    const db = await getDb();
    for (const store of ['feeds', 'items', 'itemFlags', 'meta'] as const) {
      if (db.objectStoreNames.contains(store)) {
        await db.clear(store);
      }
    }

    const mobileFeedId = crypto.randomUUID();
    await upsertFeed({
      id: mobileFeedId,
      url: sharedUrl,
      title: 'Shared Feed (mobile copy)',
      learnedIntervalMs: 3_600_000,
      lastFetched: null,
    });

    // Mobile pairs with the redeemed key
    await setStoredSyncKey(mobileKey);
    await setStoredLastSyncAt(null);

    await withMfFetch(() => triggerFirstTime());

    // After merge, mobile should have only 1 feed for sharedUrl (not 2)
    const { listFeeds } = await import('../src/db/feeds');
    const localFeeds = await listFeeds();
    const matchingFeeds = localFeeds.filter((f) => f.url === sharedUrl);
    expect(matchingFeeds.length).toBe(1);
  });

  it('preserves existing group rows when a populated device joins', async () => {
    const key = makeSyncKey('join-pop-');
    const f1Id = crypto.randomUUID();
    const f1Url = 'https://ex.com/f1';
    const f2Id = crypto.randomUUID();

    // --- "Desktop" (group owner): two feeds, F1 freshly tagged ---
    await setStoredSyncKey(key);
    await setStoredLastSyncAt(null);
    await upsertFeed({
      id: f1Id,
      url: f1Url,
      title: 'Feed 1',
      tags: ['fresh'],
      tagsAt: Date.now() - 1000,
      learnedIntervalMs: 3_600_000,
      lastFetched: null,
    });
    await upsertFeed({
      id: f2Id,
      url: 'https://ex.com/f2',
      title: 'Feed 2',
      learnedIntervalMs: 3_600_000,
      lastFetched: null,
    });

    await withMfFetch(() => triggerFirstTime());

    const pullRes = await mf.dispatchFetch(
      'http://localhost/sync/pull?since=0',
      { headers: { 'X-Sync-Key': key } },
    );
    const before = (await pullRes.json()) as { feeds: Array<Record<string, unknown>> };
    const f1Before = before.feeds.find((f) => f.feed_id === f1Id)!;
    const f2Before = before.feeds.find((f) => f.feed_id === f2Id)!;
    expect(f1Before.tags).toBe(JSON.stringify(['fresh']));

    // --- "Mobile": restored backup with the SAME feed_id but stale tags,
    //     plus one genuinely new local feed; pairs via OTP ---
    const otpRes = await mf.dispatchFetch('http://localhost/sync/otp', {
      method: 'POST',
      headers: { 'X-Sync-Key': key },
    });
    const { code } = (await otpRes.json()) as { code: string };
    const redeemRes = await mf.dispatchFetch('http://localhost/sync/redeem', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code }),
    });
    const { syncKey: mobileKey } = (await redeemRes.json()) as { syncKey: string };
    expect(mobileKey).toBe(key);

    const db = await getDb();
    for (const store of ['feeds', 'items', 'itemFlags', 'meta'] as const) {
      if (db.objectStoreNames.contains(store)) {
        await db.clear(store);
      }
    }

    await setStoredSyncKey(mobileKey);
    await setStoredLastSyncAt(null);
    await upsertFeed({
      id: f1Id,
      url: f1Url,
      title: 'Feed 1 (stale copy)',
      tags: ['stale'],
      tagsAt: Date.now() - 2000,
      learnedIntervalMs: 3_600_000,
      lastFetched: null,
    });
    await upsertFeed({
      id: crypto.randomUUID(),
      url: 'https://ex.com/f3',
      title: 'Feed 3',
      learnedIntervalMs: 3_600_000,
      lastFetched: null,
    });

    await withMfFetch(() => triggerFirstTime());

    // Server: original rows untouched (timestamps and values), new feed added.
    const afterRes = await mf.dispatchFetch(
      'http://localhost/sync/pull?since=0',
      { headers: { 'X-Sync-Key': key } },
    );
    const after = (await afterRes.json()) as { feeds: Array<Record<string, unknown>> };
    expect(after.feeds.length).toBe(3);
    const f1After = after.feeds.find((f) => f.feed_id === f1Id)!;
    const f2After = after.feeds.find((f) => f.feed_id === f2Id)!;
    expect(f1After.tags).toBe(JSON.stringify(['fresh']));
    expect(f1After.tags_at).toBe(f1Before.tags_at);
    expect(f1After.title).toBe(f1Before.title);
    expect(f1After.feed_url).toBe(f1Before.feed_url);
    expect(f2After.title_at).toBe(f2Before.title_at);

    // Local: mobile adopted the server's newer tags, and has all 3 feeds.
    const localFeeds = await listFeeds();
    const f1Local = localFeeds.find((f) => f.id === f1Id)!;
    expect(f1Local.tags).toEqual(['fresh']);
    expect(localFeeds.length).toBe(3);
  });

  it('removes a locally-restored feed that is tombstoned on the server', async () => {
    const key = makeSyncKey('tomb-111-');
    const feedId = crypto.randomUUID();
    const url = 'https://ex.com/x';

    // --- Desktop: subscribes to X, then unsubscribes (tombstone on server) ---
    await setStoredSyncKey(key);
    await setStoredLastSyncAt(null);
    await upsertFeed({
      id: feedId,
      url,
      title: 'Feed X',
      learnedIntervalMs: 3_600_000,
      lastFetched: null,
    });
    await withMfFetch(() => triggerFirstTime());

    const delRes = await mf.dispatchFetch('http://localhost/sync/push', {
      method: 'POST',
      headers: { 'X-Sync-Key': key, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        feeds: [{ feedId, deleted: { value: 1, at: Date.now() } }],
      }),
    });
    expect(delRes.status).toBe(204);

    // --- Mobile: restored backup still has X locally ---
    const db = await getDb();
    for (const store of ['feeds', 'items', 'itemFlags', 'meta'] as const) {
      if (db.objectStoreNames.contains(store)) {
        await db.clear(store);
      }
    }
    await setStoredSyncKey(key);
    await setStoredLastSyncAt(null);
    await upsertFeed({
      id: feedId,
      url,
      title: 'Feed X (backup)',
      learnedIntervalMs: 3_600_000,
      lastFetched: null,
    });

    await withMfFetch(() => triggerFirstTime());

    // X must be gone locally and NOT re-uploaded (server row still tombstoned).
    const localFeeds = await listFeeds();
    expect(localFeeds.some((f) => f.id === feedId)).toBe(false);

    const pullRes = await mf.dispatchFetch(
      'http://localhost/sync/pull?since=0',
      { headers: { 'X-Sync-Key': key } },
    );
    const pull = (await pullRes.json()) as { feeds: Array<Record<string, unknown>> };
    const row = pull.feeds.find((f) => f.feed_id === feedId)!;
    expect(row.deleted).toBe(1);
  });

  it('does not resurrect a feed tombstoned after a URL change', async () => {
    const key = makeSyncKey('tomb-url-');
    const feedId = crypto.randomUUID();

    // --- Desktop: subscribe to U1, rename to U2, then delete ---
    await setStoredSyncKey(key);
    await setStoredLastSyncAt(null);
    await upsertFeed({
      id: feedId,
      url: 'https://ex.com/u1',
      title: 'Feed U',
      learnedIntervalMs: 3_600_000,
      lastFetched: null,
    });
    await withMfFetch(() => triggerFirstTime());

    let res = await mf.dispatchFetch('http://localhost/sync/push', {
      method: 'POST',
      headers: { 'X-Sync-Key': key, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        feeds: [{ feedId, feedUrl: { value: 'https://ex.com/u2', at: Date.now() } }],
      }),
    });
    expect(res.status).toBe(204);
    res = await mf.dispatchFetch('http://localhost/sync/push', {
      method: 'POST',
      headers: { 'X-Sync-Key': key, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        feeds: [{ feedId, deleted: { value: 1, at: Date.now() } }],
      }),
    });
    expect(res.status).toBe(204);

    // --- Mobile: stale backup with the OLD URL U1 ---
    const db = await getDb();
    for (const store of ['feeds', 'items', 'itemFlags', 'meta'] as const) {
      if (db.objectStoreNames.contains(store)) {
        await db.clear(store);
      }
    }
    await setStoredSyncKey(key);
    await setStoredLastSyncAt(null);
    await upsertFeed({
      id: feedId,
      url: 'https://ex.com/u1',
      title: 'Feed U (backup)',
      learnedIntervalMs: 3_600_000,
      lastFetched: null,
    });

    await withMfFetch(() => triggerFirstTime());

    // U must not come back locally, and the server tombstone must survive.
    const localFeeds = await listFeeds();
    expect(localFeeds.some((f) => f.id === feedId)).toBe(false);

    const pullRes = await mf.dispatchFetch(
      'http://localhost/sync/pull?since=0',
      { headers: { 'X-Sync-Key': key } },
    );
    const pull = (await pullRes.json()) as { feeds: Array<Record<string, unknown>> };
    const row = pull.feeds.find((f) => f.feed_id === feedId)!;
    expect(row.deleted).toBe(1);
    expect(row.feed_url).toBe('https://ex.com/u2');
  });

  it('does not re-push flags the server already has (item-id normalization)', async () => {
    const key = makeSyncKey('flag-norm');
    const feedId = 'https://ex.com/z';
    const rawFlagId = 'https://ex.com/z::g1';

    // --- Desktop: feed Z, item g1 starred (server flag item_id is URL-encoded) ---
    await setStoredSyncKey(key);
    await setStoredLastSyncAt(null);
    await upsertFeed({
      id: feedId,
      url: feedId,
      title: 'Feed Z',
      learnedIntervalMs: 3_600_000,
      lastFetched: null,
    });
    await setFlag({ id: rawFlagId, feedId, read: 0, starred: 1 });
    await withMfFetch(() => triggerFirstTime());

    const pullRes = await mf.dispatchFetch(
      'http://localhost/sync/pull?since=0',
      { headers: { 'X-Sync-Key': key } },
    );
    const pull = (await pullRes.json()) as { flags: Array<Record<string, unknown>> };
    expect(pull.flags.length).toBe(1);
    expect(pull.flags[0].read).toBe(0);

    // --- Mobile: restored backup marks the same item read locally ---
    const db = await getDb();
    for (const store of ['feeds', 'items', 'itemFlags', 'meta'] as const) {
      if (db.objectStoreNames.contains(store)) {
        await db.clear(store);
      }
    }
    await setStoredSyncKey(key);
    await setStoredLastSyncAt(null);
    await upsertFeed({
      id: feedId,
      url: feedId,
      title: 'Feed Z (backup)',
      learnedIntervalMs: 3_600_000,
      lastFetched: null,
    });
    await setFlag({ id: rawFlagId, feedId, read: 1, starred: 1 });
    await withMfFetch(() => triggerFirstTime());

    // Mobile's read=1 must NOT be pushed (raw id matches server's encoded id);
    // server keeps read=0 and mobile adopts it.
    const afterRes = await mf.dispatchFetch(
      'http://localhost/sync/pull?since=0',
      { headers: { 'X-Sync-Key': key } },
    );
    const after = (await afterRes.json()) as { flags: Array<Record<string, unknown>> };
    expect(after.flags.length).toBe(1);
    expect(after.flags[0].read).toBe(0);

    const { getFlag } = await import('../src/db/flags');
    const local = await getFlag(rawFlagId);
    expect(local?.read).toBe(0);
  });

  it('disable then re-enable with a fresh key starts clean', async () => {
    // --- First enable: feed A on key1 ---
    const key1 = makeSyncKey('reen-111-');
    await setStoredSyncKey(key1);
    await setStoredLastSyncAt(null);
    await upsertFeed({
      id: crypto.randomUUID(),
      url: 'https://ex.com/a',
      title: 'Feed A',
      learnedIntervalMs: 3_600_000,
      lastFetched: null,
    });
    await withMfFetch(() => triggerFirstTime());

    // --- Disable (mirrors disableSync: key, lastSyncAt, and dirty set cleared) ---
    await clearStoredSyncKey();
    await setStoredLastSyncAt(null);
    await clearAllDirty();

    // Add feed B and a read flag while sync is disabled.
    await upsertFeed({
      id: crypto.randomUUID(),
      url: 'https://ex.com/b',
      title: 'Feed B',
      learnedIntervalMs: 3_600_000,
      lastFetched: null,
    });
    enqueueFlag({
      itemId: 'https://ex.com/b::p1',
      feedId: 'https://ex.com/b',
      read: 1,
      readAt: Date.now(),
      starred: 0,
      starredAt: Date.now(),
    });

    // --- Re-enable with a fresh key ---
    const key2 = makeSyncKey('reen-222-');
    await setStoredSyncKey(key2);
    await setStoredLastSyncAt(null);
    await withMfFetch(() => triggerFirstTime());

    // Both feeds reach the new group; the stale-while-disabled flag does not.
    const pullRes = await mf.dispatchFetch(
      'http://localhost/sync/pull?since=0',
      { headers: { 'X-Sync-Key': key2 } },
    );
    const pull = (await pullRes.json()) as { feeds: Array<Record<string, unknown>>; flags: Array<Record<string, unknown>> };
    expect(pull.feeds.length).toBe(2);
    expect(pull.flags.length).toBe(0);

    // Old key still has feed A (orphaned — expected).
    const oldRes = await mf.dispatchFetch(
      'http://localhost/sync/pull?since=0',
      { headers: { 'X-Sync-Key': key1 } },
    );
    const old = (await oldRes.json()) as { feeds: Array<Record<string, unknown>> };
    expect(old.feeds.length).toBe(1);
  });

  it('re-populates the server after a wipe even with a stored lastSyncAt', async () => {
    const key = makeSyncKey('wipe-111-');
    await setStoredSyncKey(key);
    await setStoredLastSyncAt(null);
    await upsertFeed({
      id: crypto.randomUUID(),
      url: 'https://ex.com/a',
      title: 'Feed A',
      learnedIntervalMs: 3_600_000,
      lastFetched: null,
    });
    await upsertFeed({
      id: crypto.randomUUID(),
      url: 'https://ex.com/b',
      title: 'Feed B',
      learnedIntervalMs: 3_600_000,
      lastFetched: null,
    });
    await withMfFetch(() => triggerFirstTime());

    // Simulate a wiped server.
    const d1 = await mf.getD1Database('DB');
    await d1.prepare('DROP TABLE IF EXISTS feeds').run();
    await d1.prepare('DROP TABLE IF EXISTS flags').run();

    // First-time setup again (lastSyncAt is now set — the flow must ignore it).
    await withMfFetch(() => triggerFirstTime());

    const pullRes = await mf.dispatchFetch(
      'http://localhost/sync/pull?since=0',
      { headers: { 'X-Sync-Key': key } },
    );
    const pull = (await pullRes.json()) as { feeds: Array<Record<string, unknown>> };
    expect(pull.feeds.length).toBe(2);
  });

  it('preserves a genuinely newer local edit on an existing feed when pairing', async () => {
    const key = makeSyncKey('lnew-111-');
    const feedId = crypto.randomUUID();
    const url = 'https://ex.com/ln';

    // --- Desktop: feed with tags ['fresh'], tagged some time ago ---
    await setStoredSyncKey(key);
    await setStoredLastSyncAt(null);
    await upsertFeed({
      id: feedId,
      url,
      title: 'Feed L',
      tags: ['fresh'],
      tagsAt: Date.now() - 5000,
      learnedIntervalMs: 3_600_000,
      lastFetched: null,
    });
    await withMfFetch(() => triggerFirstTime());

    // --- Mobile: same feed (same id), but the user re-tagged it locally
    //     with a NEWER timestamp than the server's ---
    const db = await getDb();
    for (const store of ['feeds', 'items', 'itemFlags', 'meta'] as const) {
      if (db.objectStoreNames.contains(store)) {
        await db.clear(store);
      }
    }
    await setStoredSyncKey(key);
    await setStoredLastSyncAt(null);
    await upsertFeed({
      id: feedId,
      url,
      title: 'Feed L',
      tags: ['local-new'],
      tagsAt: Date.now(),
      learnedIntervalMs: 3_600_000,
      lastFetched: null,
    });

    await withMfFetch(() => triggerFirstTime());

    // Local value is preserved (server does not converge)…
    const localFeeds = await listFeeds();
    expect(localFeeds.find((f) => f.id === feedId)?.tags).toEqual(['local-new']);

    // …and the server row is untouched.
    const pullRes = await mf.dispatchFetch(
      'http://localhost/sync/pull?since=0',
      { headers: { 'X-Sync-Key': key } },
    );
    const pull = (await pullRes.json()) as { feeds: Array<Record<string, unknown>> };
    const row = pull.feeds.find((f) => f.feed_id === feedId)!;
    expect(row.tags).toBe(JSON.stringify(['fresh']));
  });
});
