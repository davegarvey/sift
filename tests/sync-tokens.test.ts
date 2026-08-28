import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { Miniflare } from 'miniflare';
import * as esbuild from 'esbuild';
import path from 'path';

import { isValidSyncKey, KEY_FORMAT_RE } from '../server/sync/auth';
import { isValidTokenFormat, tokenFingerprint, sha256Hex, syncKeyFingerprint } from '../server/sync/tokens';
import { fingerprintSyncKey } from '../src/sync/key';
import { createSyncRoutes } from '../server/sync/routes';
import { LocalD1Database } from '../server/sync/local-d1';

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

async function register(mf: Miniflare, key: string): Promise<void> {
  const res = await mf.dispatchFetch('http://localhost/sync/register', {
    method: 'POST',
    headers: { 'X-Sync-Key': key },
  });
  expect(res.status).toBe(204);
}

async function mintCode(mf: Miniflare, key: string): Promise<{ code: string; expiresAt: number }> {
  const res = await mf.dispatchFetch('http://localhost/sync/tokens', {
    method: 'POST',
    headers: { 'X-Sync-Key': key },
  });
  expect(res.status).toBe(200);
  return (await res.json()) as { code: string; expiresAt: number };
}

async function redeemCode(mf: Miniflare, code: string): Promise<string> {
  const res = await mf.dispatchFetch('http://localhost/sync/tokens/redeem', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code }),
  });
  expect(res.status).toBe(200);
  const body = (await res.json()) as { token: string };
  return body.token;
}

describe('agent tokens: format', () => {
  it('token format is disjoint from the master-key format', () => {
    expect(isValidTokenFormat('t' + 'a'.repeat(22))).toBe(true);
    expect(isValidTokenFormat('a'.repeat(23))).toBe(false); // must start with t
    expect(isValidTokenFormat('a'.repeat(22))).toBe(false);
    expect(isValidSyncKey('t' + 'a'.repeat(22))).toBe(false);
    expect(KEY_FORMAT_RE.test('t' + 'a'.repeat(22))).toBe(false);
  });

  it('fingerprints match the browser scheme (fixed vector)', async () => {
    const token = 't0123456789abcdefghijklmn';
    const server = await tokenFingerprint(token);
    const browser = await fingerprintSyncKey(token);
    expect(server).toBe(browser);
    expect(server).toMatch(/^[0-9A-Z]{4}$/);
  });

  it('syncKeyFingerprint matches the browser group-code scheme', async () => {
    const key = makeSyncKey('grp-fp----');
    const server = await syncKeyFingerprint(key);
    const browser = await fingerprintSyncKey(key);
    expect(server).toBe(browser);
    expect(server).toMatch(/^[0-9A-Z]{4}$/);
  });

  it('sha256Hex produces a hex digest', async () => {
    expect(await sha256Hex('abc')).toHaveLength(64);
    expect(await sha256Hex('abc')).toBe(await sha256Hex('abc'));
  });
});

describe('agent tokens: lifecycle (D1)', () => {
  it('mint → redeem → pull/push with token → list → revoke', async () => {
    const mf = await createMf();
    try {
      const key = makeSyncKey('tok-life--');
      await register(mf, key);

      const { code, expiresAt } = await mintCode(mf, key);
      expect(code.length).toBe(8);
      expect(expiresAt).toBeGreaterThan(Date.now());

      // Device redeem must NOT accept an agent code (cross-table isolation).
      const deviceRedeem = await mf.dispatchFetch('http://localhost/sync/redeem', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code }),
      });
      expect(deviceRedeem.status).toBe(404);

      const token = await redeemCode(mf, code);
      expect(token.length).toBe(23);
      expect(token.startsWith('t')).toBe(true);
      expect(isValidSyncKey(token)).toBe(false);

      // Redeeming the same code again fails (one-time use).
      const again = await mf.dispatchFetch('http://localhost/sync/tokens/redeem', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code }),
      });
      expect(again.status).toBe(404);

      // Token can push.
      const pushRes = await mf.dispatchFetch('http://localhost/sync/push', {
        method: 'POST',
        headers: { 'X-Sync-Key': token, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          feeds: [{
            feedId: 'https://ex.com/agent-feed',
            feedUrl: 'https://ex.com/agent-feed',
            title: 'Agent Feed',
            deleted: 0,
          }],
        }),
      });
      expect(pushRes.status).toBe(204);

      // Token can pull.
      const pullRes = await mf.dispatchFetch('http://localhost/sync/pull?since=0', {
        headers: { 'X-Sync-Key': token },
      });
      expect(pullRes.status).toBe(200);
      const pull = (await pullRes.json()) as { feeds: Array<Record<string, unknown>> };
      expect(pull.feeds.length).toBe(1);

      const itemId = `${encodeURIComponent('https://ex.com/agent-feed')}::article-1`;
      const readRes = await mf.dispatchFetch('http://localhost/sync/push', {
        method: 'POST',
        headers: { 'X-Sync-Key': token, 'Content-Type': 'application/json' },
        body: JSON.stringify({ flags: [{ itemId, feedId: 'https://ex.com/agent-feed', read: 1 }] }),
      });
      expect(readRes.status).toBe(204);
      const statsRes = await mf.dispatchFetch('http://localhost/sync/stats/pull?since=0', {
        headers: { 'X-Sync-Key': token },
      });
      expect(statsRes.status).toBe(200);
      const stats = await statsRes.json() as { stats: Array<Record<string, unknown>> };
      expect(stats.stats.find((row) => row.feed_id === 'https://ex.com/agent-feed')?.read_once).toBe(1);
      const statsWrite = await mf.dispatchFetch('http://localhost/sync/stats/push', {
        method: 'POST',
        headers: { 'X-Sync-Key': token, 'Content-Type': 'application/json' },
        body: JSON.stringify({ stats: [{ feedId: 'https://ex.com/agent-feed', totalSeen: 10 }] }),
      });
      expect(statsWrite.status).toBe(401);

      // Master lists tokens (metadata only).
      const listRes = await mf.dispatchFetch('http://localhost/sync/tokens', {
        headers: { 'X-Sync-Key': key },
      });
      expect(listRes.status).toBe(200);
      const list = (await listRes.json()) as {
        tokens: Array<{ token_id: string; fingerprint: string; scope: string; created_at: number; last_seen_at: number | null }>;
      };
      expect(list.tokens.length).toBe(1);
      expect(list.tokens[0].scope).toBe('rw');
      expect(list.tokens[0].fingerprint).toMatch(/^[0-9A-Z]{4}$/);
      expect(list.tokens[0].last_seen_at).not.toBeNull();
      // created_at is reported in epoch milliseconds (not seconds).
      expect(list.tokens[0].created_at).toBeGreaterThan(1_700_000_000_000);
      expect(list.tokens[0].created_at).toBeLessThan(Date.now() + 60_000);
      expect(JSON.stringify(list)).not.toContain(token);

      // Revoke.
      const revokeRes = await mf.dispatchFetch('http://localhost/sync/tokens', {
        method: 'DELETE',
        headers: { 'X-Sync-Key': key, 'Content-Type': 'application/json' },
        body: JSON.stringify({ token_id: list.tokens[0].token_id }),
      });
      expect(revokeRes.status).toBe(204);

      // Token is dead; master still works.
      const deadPull = await mf.dispatchFetch('http://localhost/sync/pull?since=0', {
        headers: { 'X-Sync-Key': token },
      });
      expect(deadPull.status).toBe(401);
      const masterPull = await mf.dispatchFetch('http://localhost/sync/pull?since=0', {
        headers: { 'X-Sync-Key': key },
      });
      expect(masterPull.status).toBe(200);
    } finally {
      await mf.dispose();
    }
  });

  it('tokens are rejected on master-key-only routes', async () => {
    const mf = await createMf();
    try {
      const key = makeSyncKey('tok-allow-');
      await register(mf, key);
      const { code } = await mintCode(mf, key);
      const token = await redeemCode(mf, code);

      // /sync/otp — the takeover vector.
      const otp = await mf.dispatchFetch('http://localhost/sync/otp', {
        method: 'POST',
        headers: { 'X-Sync-Key': token },
      });
      expect(otp.status).toBe(401);

      // /sync/register — no user-row pollution.
      const reg = await mf.dispatchFetch('http://localhost/sync/register', {
        method: 'POST',
        headers: { 'X-Sync-Key': token },
      });
      expect(reg.status).toBe(401);

      // /sync/tokens mint/list/delete.
      const mint = await mf.dispatchFetch('http://localhost/sync/tokens', {
        method: 'POST',
        headers: { 'X-Sync-Key': token },
      });
      expect(mint.status).toBe(401);
      const list = await mf.dispatchFetch('http://localhost/sync/tokens', {
        headers: { 'X-Sync-Key': token },
      });
      expect(list.status).toBe(401);
      const del = await mf.dispatchFetch('http://localhost/sync/tokens', {
        method: 'DELETE',
        headers: { 'X-Sync-Key': token, 'Content-Type': 'application/json' },
        body: JSON.stringify({ token_id: 'x' }),
      });
      expect(del.status).toBe(401);
    } finally {
      await mf.dispose();
    }
  });

  it('GET /sync/status returns the group fingerprint for a token', async () => {
    const mf = await createMf();
    try {
      const key = makeSyncKey('grp-status');
      await register(mf, key);
      const { code } = await mintCode(mf, key);
      const token = await redeemCode(mf, code);

      const res = await mf.dispatchFetch('http://localhost/sync/status', {
        headers: { 'X-Sync-Key': token },
      });
      expect(res.status).toBe(200);
      const body = (await res.json()) as { groupFingerprint: string };
      expect(body.groupFingerprint).toBe(await fingerprintSyncKey(key));
      expect(body.groupFingerprint).toMatch(/^[0-9A-Z]{4}$/);
    } finally {
      await mf.dispose();
    }
  });

  it('GET /sync/status accepts a master key', async () => {
    const mf = await createMf();
    try {
      const key = makeSyncKey('grp-master-');
      await register(mf, key);

      const res = await mf.dispatchFetch('http://localhost/sync/status', {
        headers: { 'X-Sync-Key': key },
      });
      expect(res.status).toBe(200);
      const body = (await res.json()) as { groupFingerprint: string };
      expect(body.groupFingerprint).toBe(await fingerprintSyncKey(key));
    } finally {
      await mf.dispose();
    }
  });

  it('GET /sync/status rejects unauthenticated requests', async () => {
    const mf = await createMf();
    try {
      const res = await mf.dispatchFetch('http://localhost/sync/status');
      expect(res.status).toBe(401);
    } finally {
      await mf.dispose();
    }
  });

  it('an unknown or malformed token is rejected', async () => {
    const mf = await createMf();
    try {
      const res = await mf.dispatchFetch('http://localhost/sync/pull?since=0', {
        headers: { 'X-Sync-Key': 't' + 'A'.repeat(22) },
      });
      expect(res.status).toBe(401);
      const short = await mf.dispatchFetch('http://localhost/sync/pull?since=0', {
        headers: { 'X-Sync-Key': 't' + 'A'.repeat(21) },
      });
      expect(short.status).toBe(401);
    } finally {
      await mf.dispose();
    }
  });
});

describe('agent tokens: rate limits and expiry (shim)', () => {
  let db: LocalD1Database;
  let app: ReturnType<typeof createSyncRoutes>;
  let nowSeconds: number;

  beforeEach(async () => {
    db = new LocalD1Database();
    nowSeconds = Math.floor(Date.now() / 1000);
    app = createSyncRoutes(db as unknown as Parameters<typeof createSyncRoutes>[0], {
      nowSeconds: () => nowSeconds,
    });
  });

  async function shimRegister(key: string): Promise<void> {
    const res = await app.request('/sync/register', {
      method: 'POST',
      headers: { 'X-Sync-Key': key },
    });
    expect(res.status).toBe(204);
  }

  async function shimMint(key: string): Promise<number> {
    const res = await app.request('/sync/tokens', {
      method: 'POST',
      headers: { 'X-Sync-Key': key },
    });
    return res.status;
  }

  async function shimRedeem(code: string): Promise<number> {
    const res = await app.request('/sync/tokens/redeem', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code }),
    });
    return res.status;
  }

  it('mint is rate-limited per sync key (20/hr)', async () => {
    const key = makeSyncKey('tok-rl-mint');
    await shimRegister(key);
    for (let i = 0; i < 20; i++) {
      expect(await shimMint(key)).toBe(200);
    }
    const res = await app.request('/sync/tokens', {
      method: 'POST',
      headers: { 'X-Sync-Key': key },
    });
    expect(res.status).toBe(429);
    // A different key is unaffected.
    const other = makeSyncKey('tok-rl-other');
    await shimRegister(other);
    expect(await shimMint(other)).toBe(200);
  });

  it('redeem is rate-limited per IP on its own scope', async () => {
    const key = makeSyncKey('tok-rl-redeem');
    await shimRegister(key);
    const codes: string[] = [];
    for (let i = 0; i < 10; i++) {
      const res = await app.request('/sync/tokens', {
        method: 'POST',
        headers: { 'X-Sync-Key': key },
      });
      const body = (await res.json()) as { code: string };
      codes.push(body.code);
    }
    // Consume the 10 allowed redeems, then the 11th is 429.
    for (const code of codes) {
      expect(await shimRedeem(code)).toBe(200);
    }
    // A fresh code still hits the exhausted per-IP window.
    const res = await app.request('/sync/tokens', {
      method: 'POST',
      headers: { 'X-Sync-Key': key },
    });
    const fresh = (await res.json()) as { code: string };
    expect(await shimRedeem(fresh.code)).toBe(429);
  });

  it('agent codes expire after the TTL', async () => {
    const key = makeSyncKey('tok-expire-');
    await shimRegister(key);
    const res = await app.request('/sync/tokens', {
      method: 'POST',
      headers: { 'X-Sync-Key': key },
    });
    const { code } = (await res.json()) as { code: string };
    // Redeemable now.
    expect(await shimRedeem(code)).toBe(200);
  });

  it('agent codes expire after the TTL (expired path)', async () => {
    const key = makeSyncKey('tok-expired');
    await shimRegister(key);
    const res = await app.request('/sync/tokens', {
      method: 'POST',
      headers: { 'X-Sync-Key': key },
    });
    const { code } = (await res.json()) as { code: string };
    // Advance the clock past the 5-minute TTL.
    nowSeconds += 5 * 60 + 1;
    expect(await shimRedeem(code)).toBe(404);
  });
});

describe('agent tokens: cron sweep (shim)', () => {
  it('expired agent codes are swept by the same cleanup as device codes', async () => {
    const db = new LocalD1Database();
    let nowSeconds = Math.floor(Date.now() / 1000);
    const app = createSyncRoutes(db as unknown as Parameters<typeof createSyncRoutes>[0], {
      nowSeconds: () => nowSeconds,
    });
    const key = makeSyncKey('tok-cron---');
    await app.request('/sync/register', { method: 'POST', headers: { 'X-Sync-Key': key } });
    const res = await app.request('/sync/tokens', { method: 'POST', headers: { 'X-Sync-Key': key } });
    const { code } = (await res.json()) as { code: string };

    const { runSyncCron } = await import('../server/sync/cron');
    nowSeconds += 6 * 60;
    await runSyncCron(db as unknown as Parameters<typeof createSyncRoutes>[0], nowSeconds * 1000);

    const redeem = await app.request('/sync/tokens/redeem', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code }),
    });
    expect(redeem.status).toBe(404);
  });
});
