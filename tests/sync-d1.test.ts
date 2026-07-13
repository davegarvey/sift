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

      const now = Date.now();
      const pushRes = await mf.dispatchFetch('http://localhost/sync/push', {
        method: 'POST',
        headers: { 'X-Sync-Key': key, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          feeds: [{
            feedUrl: 'https://example.com/blog',
            title: { value: 'Test Feed', at: now },
            deleted: { value: 0, at: now },
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

  it('push -> pull round-trips a flag', async () => {
    const mf = await createMf();
    try {
      const key = makeSyncKey('flag-round--');
      await mf.dispatchFetch('http://localhost/sync/register', {
        method: 'POST',
        headers: { 'X-Sync-Key': key },
      });

      const now = Date.now();
      const feedUrl = 'https://example.com/news';
      const itemId = `${encodeURIComponent(feedUrl)}::article-1`;

      await mf.dispatchFetch('http://localhost/sync/push', {
        method: 'POST',
        headers: { 'X-Sync-Key': key, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          flags: [{
            itemId,
            feedUrl,
            read: { value: 1, at: now },
            starred: { value: 1, at: now },
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
            feedUrl: 'https://example.com/old',
            title: { value: 'Old Feed', at: t1 },
            deleted: { value: 0, at: t1 },
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

  it('multi-device: OTP + redeem syncs feeds across keys', async () => {
    const mf = await createMf();
    try {
      const keyA = makeSyncKey('device-A----');
      const now = Date.now();

      await mf.dispatchFetch('http://localhost/sync/register', {
        method: 'POST',
        headers: { 'X-Sync-Key': keyA },
      });

      await mf.dispatchFetch('http://localhost/sync/push', {
        method: 'POST',
        headers: { 'X-Sync-Key': keyA, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          feeds: [{
            feedUrl: 'https://example.com/rss',
            title: { value: 'Device A Feed', at: now },
            deleted: { value: 0, at: now },
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
