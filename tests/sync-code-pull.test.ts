/**
 * Chat-agent read access: GET /sync/pull?code=<agent pairing code>, and
 * sync-key rotation (/sync/rotate) which permanently orphans agent tokens.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { Miniflare } from 'miniflare';
import * as esbuild from 'esbuild';
import path from 'path';

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

async function register(mf: Miniflare, key: string): Promise<number> {
  const res = await mf.dispatchFetch('http://localhost/sync/register', {
    method: 'POST',
    headers: { 'X-Sync-Key': key },
  });
  return res.status;
}

async function mintAgentCode(mf: Miniflare, key: string): Promise<string> {
  const res = await mf.dispatchFetch('http://localhost/sync/tokens', {
    method: 'POST',
    headers: { 'X-Sync-Key': key },
  });
  expect(res.status).toBe(200);
  const body = (await res.json()) as { code: string };
  return body.code;
}

async function mintDeviceCode(mf: Miniflare, key: string): Promise<string> {
  const res = await mf.dispatchFetch('http://localhost/sync/otp', {
    method: 'POST',
    headers: { 'X-Sync-Key': key },
  });
  expect(res.status).toBe(200);
  const body = (await res.json()) as { code: string };
  return body.code;
}

async function pushFeed(mf: Miniflare, key: string, feedUrl: string): Promise<number> {
  const res = await mf.dispatchFetch('http://localhost/sync/push', {
    method: 'POST',
    headers: { 'X-Sync-Key': key, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      feeds: [{ feedId: feedUrl, feedUrl, title: 'Feed', deleted: 0 }],
    }),
  });
  return res.status;
}

function pull(
  mf: Miniflare,
  query: string,
  opts: { key?: string; ip?: string } = {},
) {
  const headers: Record<string, string> = {};
  if (opts.key) headers['X-Sync-Key'] = opts.key;
  if (opts.ip) headers['cf-connecting-ip'] = opts.ip;
  return mf.dispatchFetch(`http://localhost/sync/pull?${query}`, { headers });
}

describe('chat-agent read access: code-authenticated pull', () => {
  it('pull with a valid code returns feeds, flags, and serverTime', async () => {
    const mf = await createMf();
    try {
      const key = makeSyncKey('code-valid-');
      await register(mf, key);
      expect(await pushFeed(mf, key, 'https://ex.com/one')).toBe(204);

      const code = await mintAgentCode(mf, key);
      const res = await pull(mf, `code=${code}`);
      expect(res.status).toBe(200);
      const body = (await res.json()) as {
        serverTime: number;
        feeds: Array<{ feed_url: string }>;
        flags: unknown[];
      };
      expect(typeof body.serverTime).toBe('number');
      expect(body.feeds.length).toBe(1);
      expect(body.feeds[0].feed_url).toBe('https://ex.com/one');
      expect(Array.isArray(body.flags)).toBe(true);
    } finally {
      await mf.dispose();
    }
  });

  it('a code survives repeated pulls (multi-use until expiry)', async () => {
    const mf = await createMf();
    try {
      const key = makeSyncKey('code-multi-');
      await register(mf, key);
      const code = await mintAgentCode(mf, key);
      for (let i = 0; i < 3; i++) {
        const res = await pull(mf, `code=${code}&since=0`);
        expect(res.status).toBe(200);
      }
      // Still valid after the pulls.
      expect((await pull(mf, `code=${code}`)).status).toBe(200);
    } finally {
      await mf.dispose();
    }
  });

  it('expired code → 404', async () => {
    const mf = await createMf();
    try {
      const key = makeSyncKey('code-expire');
      await register(mf, key);
      const db = await mf.getD1Database('DB');
      await db
        .prepare("INSERT INTO pairing_codes (code, sync_key, expires_at, kind) VALUES (?, ?, ?, 'agent')")
        .bind('aaaaaa22', key, Math.floor(Date.now() / 1000) - 60)
        .run();
      const res = await pull(mf, 'code=aaaaaa22');
      expect(res.status).toBe(404);
      // Lazy expiry cleanup removes the row.
      const row = await db
        .prepare('SELECT code FROM pairing_codes WHERE code = ?')
        .bind('aaaaaa22')
        .first();
      expect(row).toBeNull();
    } finally {
      await mf.dispose();
    }
  });

  it('unknown code → 404', async () => {
    const mf = await createMf();
    try {
      const res = await pull(mf, 'code=zzzzzzzz');
      expect(res.status).toBe(404);
    } finally {
      await mf.dispose();
    }
  });

  it('device-kind code → 404 (no cross-kind access)', async () => {
    const mf = await createMf();
    try {
      const key = makeSyncKey('code-device');
      await register(mf, key);
      const deviceCode = await mintDeviceCode(mf, key);
      const res = await pull(mf, `code=${deviceCode}`);
      expect(res.status).toBe(404);
    } finally {
      await mf.dispose();
    }
  });

  it('malformed code param → 404', async () => {
    const mf = await createMf();
    try {
      for (const code of ['short', '!!!!####', 'aaaaaaaaaaaaaaaa']) {
        const res = await pull(mf, `code=${code}`, { ip: '203.0.113.20' });
        expect(res.status).toBe(404);
      }
    } finally {
      await mf.dispose();
    }
  });

  it('no-store on both header and code pulls', async () => {
    const mf = await createMf();
    try {
      const key = makeSyncKey('code-store');
      await register(mf, key);
      const code = await mintAgentCode(mf, key);
      const headerRes = await pull(mf, 'since=0', { key });
      expect(headerRes.headers.get('Cache-Control')).toBe('no-store');
      const codeRes = await pull(mf, `code=${code}`);
      expect(codeRes.headers.get('Cache-Control')).toBe('no-store');
    } finally {
      await mf.dispose();
    }
  });

  it('per-IP brute-force guard → 429 with Retry-After, no D1 writes', async () => {
    const mf = await createMf();
    try {
      const ip = '198.51.100.7';
      let last: Awaited<ReturnType<typeof pull>> | null = null;
      for (let i = 0; i < 61; i++) {
        last = await pull(mf, 'code=ffffffff', { ip });
      }
      expect(last!.status).toBe(429);
      expect(Number(last!.headers.get('Retry-After'))).toBeGreaterThan(0);
      const db = await mf.getD1Database('DB');
      const rows = await db
        .prepare("SELECT COUNT(*) AS n FROM rate_limits WHERE scope LIKE 'code-pull%'")
        .first<{ n: number }>();
      expect(rows!.n).toBe(0);
    } finally {
      await mf.dispose();
    }
  });

  it('per-(IP, code) guard: hammering one code does not block other codes', async () => {
    const mf = await createMf();
    try {
      const key = makeSyncKey('code-pair-');
      await register(mf, key);
      const goodCode = await mintAgentCode(mf, key);
      const ip = '203.0.113.31';

      // Exhaust the per-(IP, code) budget on a different code.
      for (let i = 0; i < 10; i++) {
        expect((await pull(mf, 'code=bbbbbbbb', { ip })).status).toBe(404);
      }
      expect((await pull(mf, 'code=bbbbbbbb', { ip })).status).toBe(429);

      // The good code still works from the same IP (per-IP budget intact).
      const res = await pull(mf, `code=${goodCode}`, { ip });
      expect(res.status).toBe(200);
    } finally {
      await mf.dispose();
    }
  });

  it('push with only a code → 401', async () => {
    const mf = await createMf();
    try {
      const key = makeSyncKey('code-nopush');
      await register(mf, key);
      const code = await mintAgentCode(mf, key);
      const res = await mf.dispatchFetch('http://localhost/sync/push', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          feeds: [{ feedId: 'https://ex.com/x', feedUrl: 'https://ex.com/x' }],
        }),
      });
      expect(res.status).toBe(401);
      void code;
    } finally {
      await mf.dispose();
    }
  });

  it('POST redeem consumes the code — pull with it afterwards → 404', async () => {
    const mf = await createMf();
    try {
      const key = makeSyncKey('code-redeem');
      await register(mf, key);
      const code = await mintAgentCode(mf, key);
      const redeem = await mf.dispatchFetch('http://localhost/sync/tokens/redeem', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code }),
      });
      expect(redeem.status).toBe(200);
      expect((await pull(mf, `code=${code}`)).status).toBe(404);
    } finally {
      await mf.dispose();
    }
  });
});

describe('sync-key rotation orphans everything under the old key', () => {
  it('rotate deads the old key, its tokens, and register refuses to resurrect it', async () => {
    const mf = await createMf();
    try {
      const oldKey = makeSyncKey('rot-old---');
      const newKey = makeSyncKey('rot-new---');
      await register(mf, oldKey);
      expect(await pushFeed(mf, oldKey, 'https://ex.com/rot')).toBe(204);

      // Mint + redeem a token under the old key; it works before rotation.
      const code = await mintAgentCode(mf, oldKey);
      const redeem = await mf.dispatchFetch('http://localhost/sync/tokens/redeem', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code }),
      });
      expect(redeem.status).toBe(200);
      const { token } = (await redeem.json()) as { token: string };
      expect((await pull(mf, 'since=0', { key: token })).status).toBe(200);

      // Rotate.
      const rotate = await mf.dispatchFetch('http://localhost/sync/rotate', {
        method: 'POST',
        headers: { 'X-Sync-Key': oldKey, 'Content-Type': 'application/json' },
        body: JSON.stringify({ sync_key: newKey }),
      });
      expect(rotate.status).toBe(204);

      // Old key is dead for pull and push.
      expect((await pull(mf, 'since=0', { key: oldKey })).status).toBe(401);
      expect(await pushFeed(mf, oldKey, 'https://ex.com/rot2')).toBe(401);

      // Token minted under the old key is dead.
      expect((await pull(mf, 'since=0', { key: token })).status).toBe(401);

      // Register refuses to resurrect the old key.
      expect(await register(mf, oldKey)).toBe(403);

      // The new key is a live, empty group.
      expect((await pull(mf, 'since=0', { key: newKey })).status).toBe(200);
      const body = (await (await pull(mf, 'since=0', { key: newKey })).json()) as {
        feeds: unknown[];
      };
      expect(body.feeds).toEqual([]);
    } finally {
      await mf.dispose();
    }
  });

  it('rotate rejects malformed and identical keys', async () => {
    const mf = await createMf();
    try {
      const key = makeSyncKey('rot-invald');
      await register(mf, key);
      const bad = await mf.dispatchFetch('http://localhost/sync/rotate', {
        method: 'POST',
        headers: { 'X-Sync-Key': key, 'Content-Type': 'application/json' },
        body: JSON.stringify({ sync_key: 'not-a-key' }),
      });
      expect(bad.status).toBe(400);
      const same = await mf.dispatchFetch('http://localhost/sync/rotate', {
        method: 'POST',
        headers: { 'X-Sync-Key': key, 'Content-Type': 'application/json' },
        body: JSON.stringify({ sync_key: key }),
      });
      expect(same.status).toBe(400);
    } finally {
      await mf.dispose();
    }
  });

  it('rotate requires the master key (tokens cannot rotate)', async () => {
    const mf = await createMf();
    try {
      const key = makeSyncKey('rot-token-');
      await register(mf, key);
      const code = await mintAgentCode(mf, key);
      const redeem = await mf.dispatchFetch('http://localhost/sync/tokens/redeem', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code }),
      });
      const { token } = (await redeem.json()) as { token: string };
      const res = await mf.dispatchFetch('http://localhost/sync/rotate', {
        method: 'POST',
        headers: { 'X-Sync-Key': token, 'Content-Type': 'application/json' },
        body: JSON.stringify({ sync_key: makeSyncKey('rot-token2') }),
      });
      expect(res.status).toBe(401);
    } finally {
      await mf.dispose();
    }
  });
});
