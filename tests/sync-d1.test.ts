import { describe, it, expect, beforeAll } from 'vitest';
import { Miniflare } from 'miniflare';
import * as esbuild from 'esbuild';
import path from 'path';

// Bundle the minimal sync-only worker — no frontend code, fast.
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

function makeSyncKey(label: string): string {
  const raw = label + 'xxxxxxxxxxxxxxxxxxxx';
  return raw.slice(0, 22).replace(/[^A-Za-z0-9_-]/g, 'x');
}

async function createMf(): Promise<Miniflare> {
  const mf = new Miniflare({
    modules: true,
    script: workerCode,
    d1Databases: ['DB'],
  });
  await mf.ready;
  return mf;
}

describe('sync D1 integration', () => {
  it('register creates a user and confirms idempotency', async () => {
    const mf = await createMf();
    try {
      const key = makeSyncKey('reg-test---');

      const r1 = await mf.dispatchFetch('http://localhost/sync/register', {
        method: 'POST',
        headers: { 'X-Sync-Key': key },
      });
      expect(r1.status).toBe(204);

      // Re-register with same key → idempotent
      const r2 = await mf.dispatchFetch('http://localhost/sync/register', {
        method: 'POST',
        headers: { 'X-Sync-Key': key },
      });
      expect(r2.status).toBe(204);
    } finally {
      await mf.dispose();
    }
  });

  it('register without header returns 401', async () => {
    const mf = await createMf();
    try {
      const res = await mf.dispatchFetch('http://localhost/sync/register', {
        method: 'POST',
      });
      expect(res.status).toBe(401);
    } finally {
      await mf.dispose();
    }
  });

  it('register with invalid key returns 401', async () => {
    const mf = await createMf();
    try {
      const res = await mf.dispatchFetch('http://localhost/sync/register', {
        method: 'POST',
        headers: { 'X-Sync-Key': 'too-short' },
      });
      expect(res.status).toBe(401);
    } finally {
      await mf.dispose();
    }
  });

  it('push without auth returns 401', async () => {
    const mf = await createMf();
    try {
      const res = await mf.dispatchFetch('http://localhost/sync/push', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ feeds: [] }),
      });
      expect(res.status).toBe(401);
    } finally {
      await mf.dispose();
    }
  });

  it('pull without auth returns 401', async () => {
    const mf = await createMf();
    try {
      const res = await mf.dispatchFetch('http://localhost/sync/pull?since=0');
      expect(res.status).toBe(401);
    } finally {
      await mf.dispose();
    }
  });

  it('push -> pull round-trips a feed', async () => {
    const mf = await createMf();
    try {
      const key = makeSyncKey('push-pull-');

      await mf.dispatchFetch('http://localhost/sync/register', {
        method: 'POST',
        headers: { 'X-Sync-Key': key },
      });

      const pushRes = await mf.dispatchFetch('http://localhost/sync/push', {
        method: 'POST',
        headers: { 'X-Sync-Key': key, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          feeds: [{
            feedId: 'https://example.com/blog',
            feedUrl: 'https://example.com/blog',
            title: 'Test Feed',
            deleted: 0,
          }],
        }),
      });
      expect(pushRes.status).toBe(204);

      const pullRes = await mf.dispatchFetch('http://localhost/sync/pull?since=0', {
        headers: { 'X-Sync-Key': key },
      });
      expect(pullRes.status).toBe(200);
      const pull = await pullRes.json() as { feeds: Array<Record<string, unknown>> };
      expect(pull.feeds).toBeDefined();
      expect(pull.feeds.length).toBe(1);
      expect(pull.feeds[0].feed_url).toBe('https://example.com/blog');
      expect(pull.feeds[0].title).toBe('Test Feed');
      // row_at should be > 0 (not the old value bug)
      expect((pull.feeds[0].row_at as number) > 0).toBe(true);
    } finally {
      await mf.dispose();
    }
  });

  it('push -> pull round-trips tags on a feed', async () => {
    const mf = await createMf();
    try {
      const key = makeSyncKey('tags-round-');

      await mf.dispatchFetch('http://localhost/sync/register', {
        method: 'POST',
        headers: { 'X-Sync-Key': key },
      });

      const pushRes = await mf.dispatchFetch('http://localhost/sync/push', {
        method: 'POST',
        headers: { 'X-Sync-Key': key, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          feeds: [{
            feedId: 'https://example.com/tagged',
            feedUrl: 'https://example.com/tagged',
            title: 'Tagged Feed',
            tags: ['news', 'tech'],
            deleted: 0,
          }],
        }),
      });
      expect(pushRes.status).toBe(204);

      const pullRes = await mf.dispatchFetch('http://localhost/sync/pull?since=0', {
        headers: { 'X-Sync-Key': key },
      });
      expect(pullRes.status).toBe(200);
      const pull = await pullRes.json() as { feeds: Array<Record<string, unknown>> };
      expect(pull.feeds).toBeDefined();
      expect(pull.feeds.length).toBe(1);
      expect(pull.feeds[0].feed_url).toBe('https://example.com/tagged');
      // tags should be stored as JSON text and returned as-is
      expect(pull.feeds[0].tags).toBe(JSON.stringify(['news', 'tech']));
      // tags_at is stamped by the server with the monotonic batch time
      expect((pull.feeds[0].tags_at as number) > 0).toBe(true);
      expect((pull.feeds[0].tags_at as number) === pull.feeds[0].row_at).toBe(true);
    } finally {
      await mf.dispose();
    }
  });

  it('push -> pull round-trips a flag', async () => {
    const mf = await createMf();
    try {
      const key = makeSyncKey('flag-round--');
      await mf.dispatchFetch('http://localhost/sync/register', {
        method: 'POST',
        headers: { 'X-Sync-Key': key },
      });

      const feedId = 'https://example.com/news';
      const itemId = `${encodeURIComponent(feedId)}::article-1`;

      await mf.dispatchFetch('http://localhost/sync/push', {
        method: 'POST',
        headers: { 'X-Sync-Key': key, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          flags: [{
            itemId,
            feedId,
            read: 1,
            starred: 1,
          }],
        }),
      });

      const pullRes = await mf.dispatchFetch('http://localhost/sync/pull?since=0', {
        headers: { 'X-Sync-Key': key },
      });
      expect(pullRes.status).toBe(200);
      const pull = await pullRes.json() as { flags: Array<Record<string, unknown>> };
      expect(pull.flags).toBeDefined();
      expect(pull.flags.length).toBe(1);
      expect(pull.flags[0].item_id).toBe(itemId);
      expect(pull.flags[0].read).toBe(1);
      expect(pull.flags[0].starred).toBe(1);
      expect((pull.flags[0].row_at as number) > 0).toBe(true);
    } finally {
      await mf.dispose();
    }
  });

  it('pull respects since parameter', async () => {
    const mf = await createMf();
    try {
      const key = makeSyncKey('since-test');
      await mf.dispatchFetch('http://localhost/sync/register', {
        method: 'POST',
        headers: { 'X-Sync-Key': key },
      });

      const t1 = Date.now();
      await mf.dispatchFetch('http://localhost/sync/push', {
        method: 'POST',
        headers: { 'X-Sync-Key': key, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          feeds: [{
            feedId: 'https://example.com/old',
            feedUrl: 'https://example.com/old',
            title: 'Old Feed',
            deleted: 0,
          }],
        }),
      });

      // Pull with since = now to exclude the first feed
      const sincePull = await mf.dispatchFetch(`http://localhost/sync/pull?since=${t1 + 1000}`, {
        headers: { 'X-Sync-Key': key },
      });
      expect(sincePull.status).toBe(200);
      const sinceData = await sincePull.json() as { feeds: Array<Record<string, unknown>> };
      expect(sinceData.feeds.length).toBe(0);

      // Pull with since = 0 should include it
      const fullPull = await mf.dispatchFetch('http://localhost/sync/pull?since=0', {
        headers: { 'X-Sync-Key': key },
      });
      const fullData = await fullPull.json() as { feeds: Array<Record<string, unknown>> };
      expect(fullData.feeds.length).toBe(1);
    } finally {
      await mf.dispose();
    }
  });

  it('push with legacy timestamp wrappers is rejected with 400', async () => {
    const mf = await createMf();
    try {
      const key = makeSyncKey('legacy-400');
      await mf.dispatchFetch('http://localhost/sync/register', {
        method: 'POST',
        headers: { 'X-Sync-Key': key },
      });

      const res = await mf.dispatchFetch('http://localhost/sync/push', {
        method: 'POST',
        headers: { 'X-Sync-Key': key, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          feeds: [{
            feedId: 'https://example.com/legacy',
            feedUrl: { value: 'https://example.com/legacy', at: Date.now() },
            deleted: { value: 0, at: Date.now() },
          }],
        }),
      });
      expect(res.status).toBe(400);
      const body = await res.json() as { error: string; field: string };
      expect(body.field).toBe('feedUrl');

      // And nothing was written.
      const pull = await mf.dispatchFetch('http://localhost/sync/pull?since=0', {
        headers: { 'X-Sync-Key': key },
      });
      const data = await pull.json() as { feeds: Array<Record<string, unknown>> };
      expect(data.feeds.length).toBe(0);
    } finally {
      await mf.dispose();
    }
  });

  it('multi-device: OTP + redeem syncs feeds across keys', async () => {
    const mf = await createMf();
    try {
      const keyA = makeSyncKey('device-A----');

      await mf.dispatchFetch('http://localhost/sync/register', {
        method: 'POST',
        headers: { 'X-Sync-Key': keyA },
      });

      await mf.dispatchFetch('http://localhost/sync/push', {
        method: 'POST',
        headers: { 'X-Sync-Key': keyA, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          feeds: [{
            feedId: 'https://example.com/rss',
            feedUrl: 'https://example.com/rss',
            title: 'Device A Feed',
            deleted: 0,
          }],
        }),
      });

      const otpRes = await mf.dispatchFetch('http://localhost/sync/otp', {
        method: 'POST',
        headers: { 'X-Sync-Key': keyA },
      });
      expect(otpRes.status).toBe(200);
      const otp = await otpRes.json() as { code: string };
      expect(otp.code).toBeTruthy();
      expect(otp.code.length).toBe(8);

      const redeemRes = await mf.dispatchFetch('http://localhost/sync/redeem', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: otp.code }),
      });
      expect(redeemRes.status).toBe(200);
      const redeem = await redeemRes.json() as { syncKey: string };
      expect(redeem.syncKey).toBe(keyA);

      // Device B pulls using the redeemed key
      const pullRes = await mf.dispatchFetch('http://localhost/sync/pull?since=0', {
        headers: { 'X-Sync-Key': redeem.syncKey },
      });
      expect(pullRes.status).toBe(200);
      const pull = await pullRes.json() as { feeds: Array<Record<string, unknown>> };
      expect(pull.feeds.length).toBe(1);
      expect(pull.feeds[0]).toMatchObject({
        feed_url: 'https://example.com/rss',
        title: 'Device A Feed',
      });
    } finally {
      await mf.dispose();
    }
  });

  it('OTP returns 401 for unregistered key', async () => {
    const mf = await createMf();
    try {
      const res = await mf.dispatchFetch('http://localhost/sync/otp', {
        method: 'POST',
        headers: { 'X-Sync-Key': makeSyncKey('no-such') },
      });
      expect(res.status).toBe(401);
    } finally {
      await mf.dispose();
    }
  });

  it('redeem of unknown code returns 404', async () => {
    const mf = await createMf();
    try {
      const res = await mf.dispatchFetch('http://localhost/sync/redeem', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: 'deadbeef' }),
      });
      expect(res.status).toBe(404);
    } finally {
      await mf.dispose();
    }
  });

  it('redeem of invalid format returns 400', async () => {
    const mf = await createMf();
    try {
      const res = await mf.dispatchFetch('http://localhost/sync/redeem', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: 'ab' }),
      });
      expect(res.status).toBe(400);
    } finally {
      await mf.dispose();
    }
  });

  it('redeem consumes code on first use (one-time)', async () => {
    const mf = await createMf();
    try {
      const key = makeSyncKey('one-time--');
      await mf.dispatchFetch('http://localhost/sync/register', {
        method: 'POST',
        headers: { 'X-Sync-Key': key },
      });

      const otpRes = await mf.dispatchFetch('http://localhost/sync/otp', {
        method: 'POST',
        headers: { 'X-Sync-Key': key },
      });
      const otp = await otpRes.json() as { code: string };

      // First redeem → success
      const r1 = await mf.dispatchFetch('http://localhost/sync/redeem', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: otp.code }),
      });
      expect(r1.status).toBe(200);

      // Second redeem with same code → 404 (deleted after use)
      const r2 = await mf.dispatchFetch('http://localhost/sync/redeem', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: otp.code }),
      });
      expect(r2.status).toBe(404);
    } finally {
      await mf.dispose();
    }
  });

  it('caps capabilities endpoint', async () => {
    const mf = await createMf();
    try {
      const res = await mf.dispatchFetch('http://localhost/sync/capabilities');
      expect(res.status).toBe(200);
      const cap = await res.json() as { sync: boolean };
      expect(cap.sync).toBe(true);
    } finally {
      await mf.dispose();
    }
  });

  it('push with empty feeds/flags returns 204 no-op', async () => {
    const mf = await createMf();
    try {
      const key = makeSyncKey('empty-push');
      await mf.dispatchFetch('http://localhost/sync/register', {
        method: 'POST',
        headers: { 'X-Sync-Key': key },
      });

      const res = await mf.dispatchFetch('http://localhost/sync/push', {
        method: 'POST',
        headers: { 'X-Sync-Key': key, 'Content-Type': 'application/json' },
        body: JSON.stringify({ feeds: [], flags: [] }),
      });
      expect(res.status).toBe(204);
    } finally {
      await mf.dispose();
    }
  });
});

async function setupKey(mf: Miniflare, label: string): Promise<string> {
  const key = makeSyncKey(label);
  await mf.dispatchFetch('http://localhost/sync/register', {
    method: 'POST',
    headers: { 'X-Sync-Key': key },
  });
  return key;
}

async function push(mf: Miniflare, key: string, body: unknown): Promise<number> {
  const res = await mf.dispatchFetch('http://localhost/sync/push', {
    method: 'POST',
    headers: { 'X-Sync-Key': key, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return res.status;
}

async function pushStats(mf: Miniflare, key: string, body: unknown) {
  return mf.dispatchFetch('http://localhost/sync/stats/push', {
    method: 'POST',
    headers: { 'X-Sync-Key': key, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

async function pullStats(mf: Miniflare, key: string, since = 0): Promise<{ serverTime: number; stats: Array<Record<string, unknown>>; markers: Array<Record<string, unknown>> }> {
  const res = await mf.dispatchFetch(`http://localhost/sync/stats/pull?since=${since}`, {
    headers: { 'X-Sync-Key': key },
  });
  expect(res.status).toBe(200);
  return await res.json() as { serverTime: number; stats: Array<Record<string, unknown>>; markers: Array<Record<string, unknown>> };
}

async function pullFeeds(mf: Miniflare, key: string): Promise<Array<Record<string, unknown>>> {
  const res = await mf.dispatchFetch('http://localhost/sync/pull?since=0', {
    headers: { 'X-Sync-Key': key },
  });
  expect(res.status).toBe(200);
  const body = await res.json() as { feeds: Array<Record<string, unknown>> };
  return body.feeds;
}

function feedPayload(feedId: string, url: string, extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    feedId,
    feedUrl: url,
    title: `Feed ${feedId.slice(0, 6)}`,
    deleted: 0,
    ...extra,
  };
}

describe('sync D1 tombstone semantics', () => {

  it('a metadata-only push does not clear a tombstone', async () => {
    const mf = await createMf();
    try {
      const key = await setupKey(mf, 'meta-noclear');
      const id = 'https://example.com/meta';
      await push(mf, key, { feeds: [feedPayload(id, id)] });
      await push(mf, key, {
        feeds: [{ feedId: id, deleted: 1 }],
      });
      await push(mf, key, {
        feeds: [{ feedId: id, feedUrl: id, title: 'Renamed' }],
      });
      const feeds = await pullFeeds(mf, key);
      const row = feeds.find((f) => f.feed_id === id);
      expect(row?.deleted).toBe(1);
      expect(row?.title).toBe('Renamed');
    } finally {
      await mf.dispose();
    }
  });

  it('a deleted:1 push never regresses an existing tombstone', async () => {
    const mf = await createMf();
    try {
      const key = await setupKey(mf, 'no-regress-');
      const id = 'https://example.com/regress';
      await push(mf, key, { feeds: [feedPayload(id, id)] });
      await push(mf, key, {
        feeds: [{ feedId: id, deleted: 1 }],
      });
      let feeds = await pullFeeds(mf, key);
      const firstStamp = feeds.find((f) => f.feed_id === id)?.deleted_at as number;
      expect(firstStamp).toBeGreaterThan(0);

      // A second delete (with a URL this time) lands in a newer batch:
      // the tombstone stamp advances but the row stays tombstoned.
      await push(mf, key, {
        feeds: [{ feedId: id, feedUrl: id, deleted: 1 }],
      });
      feeds = await pullFeeds(mf, key);
      const row = feeds.find((f) => f.feed_id === id);
      expect(row?.deleted).toBe(1);
      expect((row?.deleted_at as number) > firstStamp).toBe(true);
    } finally {
      await mf.dispose();
    }
  });

  it('a delete tombstones every row sharing the URL', async () => {
    const mf = await createMf();
    try {
      const key = await setupKey(mf, 'delete-url');
      const url = 'https://example.com/shared';
      const a = 'device-a-feed';
      const b = 'device-b-feed';
      await push(mf, key, { feeds: [feedPayload(a, url), feedPayload(b, url)] });
      await push(mf, key, {
        feeds: [{ feedId: a, feedUrl: url, deleted: 1 }],
      });
      const feeds = await pullFeeds(mf, key);
      const ra = feeds.find((f) => f.feed_id === a);
      const rb = feeds.find((f) => f.feed_id === b);
      expect(ra?.deleted).toBe(1);
      expect(rb?.deleted).toBe(1);
    } finally {
      await mf.dispose();
    }
  });

  it('a URL-less delete resolves the URL from the stored row', async () => {
    const mf = await createMf();
    try {
      const key = await setupKey(mf, 'urlless-del');
      const url = 'https://example.com/urlless';
      const a = 'urlless-a';
      const b = 'urlless-b';
      await push(mf, key, { feeds: [feedPayload(a, url), feedPayload(b, url)] });
      await push(mf, key, {
        feeds: [{ feedId: a, deleted: 1 }],
      });
      const feeds = await pullFeeds(mf, key);
      expect(feeds.find((f) => f.feed_id === a)?.deleted).toBe(1);
      expect(feeds.find((f) => f.feed_id === b)?.deleted).toBe(1);
    } finally {
      await mf.dispose();
    }
  });

  it('a subscribe revives the oldest tombstoned row by URL instead of inserting', async () => {
    const mf = await createMf();
    try {
      const key = await setupKey(mf, 'revive-url');
      const url = 'https://example.com/revive';
      const original = 'original-id';
      const fresh = 'fresh-uuid';
      await push(mf, key, { feeds: [feedPayload(original, url)] });
      await push(mf, key, {
        feeds: [{ feedId: original, deleted: 1 }],
      });
      await push(mf, key, { feeds: [feedPayload(fresh, url)] });
      const feeds = await pullFeeds(mf, key);
      const rows = feeds.filter((f) => f.feed_url === url);
      expect(rows.length).toBe(1);
      expect(rows[0].feed_id).toBe(original);
      expect(rows[0].deleted).toBe(0);
    } finally {
      await mf.dispose();
    }
  });

  it('a same-batch delete-then-subscribe revives the in-batch tombstone', async () => {
    const mf = await createMf();
    try {
      const key = await setupKey(mf, 'batch-del-sub');
      const url = 'https://example.com/batch1';
      const original = 'batch-orig';
      const fresh = 'batch-fresh';
      await push(mf, key, { feeds: [feedPayload(original, url)] });
      await push(mf, key, {
        feeds: [
          { feedId: original, feedUrl: url, deleted: 1 },
          feedPayload(fresh, url),
        ],
      });
      const feeds = await pullFeeds(mf, key);
      const rows = feeds.filter((f) => f.feed_url === url);
      expect(rows.length).toBe(1);
      expect(rows[0].feed_id).toBe(original);
      expect(rows[0].deleted).toBe(0);
    } finally {
      await mf.dispose();
    }
  });

  it('a same-batch subscribe-then-delete leaves no live row', async () => {
    const mf = await createMf();
    try {
      const key = await setupKey(mf, 'batch-sub-del');
      const url = 'https://example.com/batch2';
      const keeper = 'batch-keeper';
      await push(mf, key, { feeds: [feedPayload(keeper, url)] });
      await push(mf, key, {
        feeds: [
          feedPayload('batch-new', url),
          { feedId: keeper, feedUrl: url, deleted: 1 },
        ],
      });
      const feeds = await pullFeeds(mf, key);
      const live = feeds.filter((f) => f.feed_url === url && f.deleted === 0);
      expect(live.length).toBe(0);
    } finally {
      await mf.dispose();
    }
  });

  it('a delete of a server-unknown feed_id still tombstones URL siblings', async () => {
    const mf = await createMf();
    try {
      const key = await setupKey(mf, 'ghost-del-');
      const url = 'https://example.com/ghost';
      const b = 'ghost-sibling';
      await push(mf, key, { feeds: [feedPayload(b, url)] });
      await push(mf, key, {
        feeds: [{ feedId: 'never-pushed', feedUrl: url, deleted: 1 }],
      });
      const feeds = await pullFeeds(mf, key);
      const ghost = feeds.find((f) => f.feed_id === 'never-pushed');
      expect(ghost?.deleted).toBe(1);
      expect(feeds.find((f) => f.feed_id === b)?.deleted).toBe(1);
    } finally {
      await mf.dispose();
    }
  });

  it('a delete tombstones rows under the payload URL (the winning URL)', async () => {
    const mf = await createMf();
    try {
      const key = await setupKey(mf, 'rename-del');
      const oldUrl = 'https://example.com/old';
      const newUrl = 'https://example.com/new';
      const target = 'rename-target';
      const sibling = 'rename-sibling';
      await push(mf, key, { feeds: [feedPayload(target, oldUrl)] });
      await push(mf, key, { feeds: [feedPayload(sibling, newUrl)] });
      // Rename target to the sibling's URL.
      await push(mf, key, {
        feeds: [{ feedId: target, feedUrl: newUrl }],
      });
      // Delete the target: the payload URL is the winning URL (the server
      // stamps it newer than any stored value), so the sibling is tombstoned.
      await push(mf, key, {
        feeds: [{ feedId: target, feedUrl: newUrl, deleted: 1 }],
      });
      const feeds = await pullFeeds(mf, key);
      const rt = feeds.find((f) => f.feed_id === target);
      expect(rt?.deleted).toBe(1);
      expect(rt?.feed_url).toBe(newUrl);
      const rs = feeds.find((f) => f.feed_id === sibling);
      expect(rs?.deleted).toBe(1);
    } finally {
      await mf.dispose();
    }
  });

  it('a subscribe during the tombstone window revives without creating a duplicate', async () => {
    const mf = await createMf();
    try {
      const key = await setupKey(mf, 'tomb-window');
      const url = 'https://example.com/window';
      const original = 'window-orig';
      await push(mf, key, { feeds: [feedPayload(original, url)] });
      await push(mf, key, {
        feeds: [{ feedId: original, deleted: 1 }],
      });
      await push(mf, key, {
        feeds: [{ feedId: original, feedUrl: url, deleted: 0 }],
      });
      const feeds = await pullFeeds(mf, key);
      const rows = feeds.filter((f) => f.feed_url === url);
      expect(rows.length).toBe(1);
      expect(rows[0].deleted).toBe(0);
    } finally {
      await mf.dispose();
    }
  });
});

describe('sync D1 reading statistics', () => {
  it('deduplicates current reads and preserves the lifetime marker across unread', async () => {
    const mf = await createMf();
    try {
      const key = await setupKey(mf, 'stats-read---');
      const feedId = 'stats-feed';
      const itemId = `${encodeURIComponent(feedId)}::article-1`;
      expect(await push(mf, key, { feeds: [feedPayload(feedId, 'https://example.com/stats')] })).toBe(204);
      expect(await push(mf, key, { flags: [{ itemId, feedId, read: 1 }] })).toBe(204);
      expect(await push(mf, key, { flags: [{ itemId, feedId, read: 0 }] })).toBe(204);
      expect(await push(mf, key, { flags: [{ itemId, feedId, read: 1 }] })).toBe(204);
      const stats = await pullStats(mf, key);
      expect(stats.stats.find((row) => row.feed_id === feedId)?.read_once).toBe(1);
      expect(stats.markers.filter((row) => row.item_id === itemId).length).toBeGreaterThan(0);
    } finally {
      await mf.dispose();
    }
  });

  it('accepts idempotent historical markers and max volume snapshots', async () => {
    const mf = await createMf();
    try {
      const key = await setupKey(mf, 'stats-marker-');
      const feedId = 'historical-feed';
      const itemId = `${encodeURIComponent(feedId)}::article-1`;
      const first = await pushStats(mf, key, {
        stats: [{ feedId, totalSeen: 10, feedUrl: 'https://example.com/history', title: 'History' }],
        markers: [{ itemId, feedId }],
      });
      expect(first.status).toBe(200);
      const firstBody = await first.json() as { acknowledged: string[]; stats: Array<Record<string, unknown>> };
      expect(firstBody.acknowledged).toEqual([itemId]);
      expect(firstBody.stats[0].read_once).toBe(1);
      const second = await pushStats(mf, key, {
        stats: [{ feedId, totalSeen: 5 }],
        markers: [{ itemId, feedId }],
      });
      expect(second.status).toBe(200);
      const secondBody = await second.json() as { stats: Array<Record<string, unknown>> };
      expect(secondBody.stats[0].total_seen).toBe(10);
      expect(secondBody.stats[0].read_once).toBe(1);
    } finally {
      await mf.dispose();
    }
  });

  it('keeps statistics on a separate cursor and rejects stats writes from agents', async () => {
    const mf = await createMf();
    try {
      const key = await setupKey(mf, 'stats-cursor-');
      const feedId = 'cursor-feed';
      await pushStats(mf, key, { stats: [{ feedId, totalSeen: 2 }] });
      const stats = await pullStats(mf, key);
      const ordinary = await mf.dispatchFetch('http://localhost/sync/pull?since=0', { headers: { 'X-Sync-Key': key } });
      const ordinaryBody = await ordinary.json() as { flags: Array<Record<string, unknown>> };
      expect(ordinaryBody.flags).toEqual([]);
      expect(stats.stats.find((row) => row.feed_id === feedId)?.total_seen).toBe(2);
      const invalid = await mf.dispatchFetch('http://localhost/sync/stats/push', {
        method: 'POST',
        headers: { 'X-Sync-Key': 't'.padEnd(23, 'x'), 'Content-Type': 'application/json' },
        body: JSON.stringify({ stats: [{ feedId, totalSeen: 3 }] }),
      });
      expect(invalid.status).toBe(401);
    } finally {
      await mf.dispose();
    }
  });
});

describe('sync D1 time consistency', () => {
  it('server time is monotonic and epoch-anchored', async () => {
    const mf = await createMf();
    try {
      await mf.dispatchFetch('http://localhost/sync/capabilities');
      const d1 = await mf.getD1Database('DB');
      const { nextMonotonicTime, currentMonotonicTime } = await import('../server/sync/monotonic');
      const t1 = await nextMonotonicTime(d1);
      const t2 = await nextMonotonicTime(d1);
      const t3 = await nextMonotonicTime(d1);
      expect(t1).toBeGreaterThan(1e12);
      expect(t2).toBeGreaterThan(t1);
      expect(t3).toBeGreaterThan(t2);
      const cur = await currentMonotonicTime(d1);
      expect(cur).toBeGreaterThanOrEqual(t3);
    } finally {
      await mf.dispose();
    }
  });

  it('rows in one batch share a single row_at, strictly increasing across batches', async () => {
    const mf = await createMf();
    try {
      const key = await setupKey(mf, 'batch-rowat');
      await push(mf, key, {
        feeds: [
          feedPayload('rowat-a', 'https://ex.com/a'),
          feedPayload('rowat-b', 'https://ex.com/b'),
          feedPayload('rowat-c', 'https://ex.com/c'),
        ],
      });
      let feeds = await pullFeeds(mf, key);
      const r1 = feeds.find((f) => f.feed_id === 'rowat-a')?.row_at as number;
      expect(feeds.find((f) => f.feed_id === 'rowat-b')?.row_at).toBe(r1);
      expect(feeds.find((f) => f.feed_id === 'rowat-c')?.row_at).toBe(r1);

      await push(mf, key, {
        feeds: [{ feedId: 'rowat-a', feedUrl: 'https://ex.com/a', title: 'Renamed' }],
      });
      feeds = await pullFeeds(mf, key);
      const r2 = feeds.find((f) => f.feed_id === 'rowat-a')?.row_at as number;
      expect(r2).toBeGreaterThan(r1);
    } finally {
      await mf.dispose();
    }
  });

  it('a sibling-tombstoned row shares the batch row_at', async () => {
    const mf = await createMf();
    try {
      const key = await setupKey(mf, 'sib-rowat-');
      const url = 'https://ex.com/sib';
      await push(mf, key, { feeds: [feedPayload('sib-a', url), feedPayload('sib-b', url)] });
      await push(mf, key, {
        feeds: [{ feedId: 'sib-a', feedUrl: url, deleted: 1 }],
      });
      const feeds = await pullFeeds(mf, key);
      const ra = feeds.find((f) => f.feed_id === 'sib-a')?.row_at as number;
      const rb = feeds.find((f) => f.feed_id === 'sib-b')?.row_at as number;
      expect(rb).toBe(ra);
    } finally {
      await mf.dispose();
    }
  });

  it('a pull with since = serverTime is incremental; the inclusive comparison heals same-ms rows', async () => {
    const mf = await createMf();
    try {
      const key = await setupKey(mf, 'incr-pull-');
      await push(mf, key, { feeds: [feedPayload('incr-a', 'https://ex.com/incr')] });

      const first = await mf.dispatchFetch('http://localhost/sync/pull?since=0', {
        headers: { 'X-Sync-Key': key },
      });
      const firstBody = await first.json() as { feeds: Array<Record<string, unknown>>; serverTime: number };
      expect(firstBody.feeds.length).toBe(1);
      const rowAt = firstBody.feeds[0].row_at as number;

      // Pull with since = that row's row_at: inclusive comparison returns it once.
      const second = await mf.dispatchFetch(`http://localhost/sync/pull?since=${rowAt}`, {
        headers: { 'X-Sync-Key': key },
      });
      const secondBody = await second.json() as { feeds: Array<Record<string, unknown>> };
      expect(secondBody.feeds.length).toBe(1);

      // Cursor past it: nothing.
      const third = await mf.dispatchFetch(`http://localhost/sync/pull?since=${rowAt + 1}`, {
        headers: { 'X-Sync-Key': key },
      });
      const thirdBody = await third.json() as { feeds: Array<Record<string, unknown>> };
      expect(thirdBody.feeds.length).toBe(0);

      // A pre-change cursor (old counter scale) still gets a full dump once.
      const legacy = await mf.dispatchFetch('http://localhost/sync/pull?since=1', {
        headers: { 'X-Sync-Key': key },
      });
      const legacyBody = await legacy.json() as { feeds: Array<Record<string, unknown>> };
      expect(legacyBody.feeds.length).toBe(1);
    } finally {
      await mf.dispose();
    }
  });

  it('the feed row cap counts only live (non-tombstoned) rows', async () => {
    const mf = await createMf();
    try {
      const key = await setupKey(mf, 'cap-live--');
      for (let i = 0; i < 5; i++) {
        await push(mf, key, { feeds: [feedPayload(`cap-${i}`, `https://ex.com/cap-${i}`)] });
      }
      for (let i = 0; i < 3; i++) {
        await push(mf, key, {
          feeds: [{ feedId: `cap-${i}`, feedUrl: `https://ex.com/cap-${i}`, deleted: 1 }],
        });
      }
      const d1 = await mf.getD1Database('DB');
      const total = await d1.prepare('SELECT COUNT(*) AS n FROM feeds WHERE sync_key = ?').bind(key).first<{ n: number }>();
      const live = await d1.prepare('SELECT COUNT(*) AS n FROM feeds WHERE sync_key = ? AND deleted = 0').bind(key).first<{ n: number }>();
      expect(total?.n).toBe(5);
      expect(live?.n).toBe(2);
    } finally {
      await mf.dispose();
    }
  });
});
