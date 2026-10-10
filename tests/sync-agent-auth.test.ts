/**
 * Agent token authentication: bearer header, scope enforcement, OAuth token
 * expiry, per-token rate-limit buckets, the OAuth storage migration and the
 * scheduled cleanup, against Miniflare + real SQLite D1.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { convertV4MiniflareOptions, Miniflare } from 'miniflare';
import * as esbuild from 'esbuild';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'path';
import { authenticateToken, parseScopes, rateLimitKey, type SyncKeyContext } from '../server/sync/auth';
import { RATE_LIMITS } from '../server/sync/ratelimit';
import { generateToken, generateTokenId, sha256Hex, tokenFingerprint } from '../server/sync/tokens';

let workerCode: string;

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

type D1 = Awaited<ReturnType<Miniflare['getD1Database']>>;

function makeSyncKey(label: string): string {
  return (label + 'xxxxxxxxxxxxxxxxxxxxxx').slice(0, 22).replace(/[^A-Za-z0-9_-]/g, 'x');
}

async function createMf(): Promise<Miniflare> {
  const mf = new Miniflare(convertV4MiniflareOptions({
    modules: true,
    script: workerCode,
    d1Databases: ['DB', 'POLL_DB'],
  }));
  await mf.ready;
  return mf;
}

function nowSeconds(): number {
  return Math.floor(Date.now() / 1000);
}

async function register(mf: Miniflare, key: string): Promise<void> {
  const res = await mf.dispatchFetch('http://localhost/sync/register', {
    method: 'POST',
    headers: { 'X-Sync-Key': key },
  });
  expect(res.status).toBe(204);
}

async function pairedToken(mf: Miniflare, key: string, label?: unknown): Promise<string> {
  const minted = await mf.dispatchFetch('http://localhost/sync/tokens', {
    method: 'POST',
    headers: { 'X-Sync-Key': key },
  });
  const { code } = (await minted.json()) as { code: string };
  const redeemed = await mf.dispatchFetch('http://localhost/sync/tokens/redeem', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(label === undefined ? { code } : { code, label }),
  });
  return ((await redeemed.json()) as { token: string }).token;
}

interface OAuthTokenOptions {
  scopes?: string;
  expiresAt?: number | null;
  refreshExpiresAt?: number | null;
}

async function oauthToken(db: D1, syncKey: string, options: OAuthTokenOptions = {}): Promise<{ token: string; tokenId: string }> {
  const token = generateToken();
  const tokenId = generateTokenId();
  await db
    .prepare(
      `INSERT INTO tokens
         (token_id, token_hash, sync_key, scope, fingerprint, created_at, origin, client_id, client_name, scopes, expires_at, refresh_hash, refresh_expires_at, family_id)
       VALUES (?, ?, ?, 'rw', ?, ?, 'oauth', 'client-1', 'Test Agent', ?, ?, ?, ?, ?)`,
    )
    .bind(
      tokenId,
      await sha256Hex(token),
      syncKey,
      await tokenFingerprint(token),
      nowSeconds(),
      options.scopes ?? 'read write',
      options.expiresAt === undefined ? nowSeconds() + 3600 : options.expiresAt,
      await sha256Hex(`refresh-${tokenId}`),
      options.refreshExpiresAt === undefined ? nowSeconds() + 86_400 : options.refreshExpiresAt,
      `family-${tokenId}`,
    )
    .run();
  return { token, tokenId };
}

function bearer(token: string): Record<string, string> {
  return { Authorization: `Bearer ${token}` };
}

function pull(mf: Miniflare, headers: Record<string, string>, query = 'since=0'): Promise<Awaited<ReturnType<Miniflare['dispatchFetch']>>> {
  return mf.dispatchFetch(`http://localhost/sync/pull?${query}`, { headers });
}

function push(mf: Miniflare, headers: Record<string, string>, body: unknown): Promise<Awaited<ReturnType<Miniflare['dispatchFetch']>>> {
  return mf.dispatchFetch('http://localhost/sync/push', {
    method: 'POST',
    headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

async function count(db: D1, sql: string, ...binds: unknown[]): Promise<number> {
  return (await db.prepare(sql).bind(...binds).first<{ n: number }>())?.n ?? 0;
}

async function setup(label: string): Promise<{ mf: Miniflare; key: string; db: D1 }> {
  const mf = await createMf();
  const key = makeSyncKey(label);
  await register(mf, key);
  const db = await mf.getD1Database('DB');
  await db
    .prepare('CREATE TABLE IF NOT EXISTS feed_fetch_failures (feed_key TEXT PRIMARY KEY, status INTEGER NOT NULL, retry_at INTEGER NOT NULL, updated_at INTEGER NOT NULL)')
    .run();
  return { mf, key, db };
}

describe('bearer authentication', () => {
  it('accepts a paired token in the Authorization header and the X-Sync-Key header', async () => {
    const { mf, key } = await setup('bearer-ok');
    try {
      const token = await pairedToken(mf, key);
      expect((await pull(mf, bearer(token))).status).toBe(200);
      expect((await pull(mf, { 'X-Sync-Key': token })).status).toBe(200);
      expect((await push(mf, bearer(token), { feeds: [{ feedId: 'f1', feedUrl: 'https://ex.com/f', deleted: 0 }] })).status).toBe(204);
      expect((await mf.dispatchFetch('http://localhost/sync/status', { headers: bearer(token) })).status).toBe(200);
    } finally {
      await mf.dispose();
    }
  });

  it('rejects unknown tokens, master keys and malformed values as bearers', async () => {
    const { mf, key } = await setup('bearer-bad');
    try {
      expect((await pull(mf, bearer(generateToken()))).status).toBe(401);
      expect((await pull(mf, bearer(key))).status).toBe(401);
      expect((await pull(mf, bearer('nonsense'))).status).toBe(401);
    } finally {
      await mf.dispose();
    }
  });

  it('keeps a bearer token out of master-only routes', async () => {
    const { mf, key } = await setup('bearer-mstr');
    try {
      const token = await pairedToken(mf, key);
      for (const [method, route] of [['POST', '/sync/otp'], ['POST', '/sync/tokens'], ['GET', '/sync/tokens'], ['POST', '/sync/stats/push'], ['DELETE', '/sync/account']]) {
        const res = await mf.dispatchFetch(`http://localhost${route}`, { method, headers: bearer(token) });
        expect(res.status, `${method} ${route}`).toBe(401);
      }
    } finally {
      await mf.dispose();
    }
  });

  it('no longer authenticates a pull with a pairing code', async () => {
    const { mf, key } = await setup('code-gone--');
    try {
      const minted = await mf.dispatchFetch('http://localhost/sync/tokens', { method: 'POST', headers: { 'X-Sync-Key': key } });
      const { code } = (await minted.json()) as { code: string };
      expect((await pull(mf, {}, `since=0&code=${code}`)).status).toBe(401);
    } finally {
      await mf.dispose();
    }
  });

  it('exposes authenticateToken for bearer lookups outside the sync routes', async () => {
    const { mf, key, db } = await setup('helper-----');
    try {
      const { token, tokenId } = await oauthToken(db, key, { scopes: 'read' });
      expect(await authenticateToken(db as unknown as D1Database, token)).toEqual({
        syncKey: key,
        tokenId,
        scopes: ['read'],
        origin: 'oauth',
      });
      expect(await authenticateToken(db as unknown as D1Database, generateToken())).toBeNull();
      expect(await authenticateToken(db as unknown as D1Database, key)).toBeNull();
    } finally {
      await mf.dispose();
    }
  });
});

interface TokenRow {
  token_id: string;
  label: string | null;
  client_name: string | null;
  origin: string;
  scopes: string;
  created_at: number;
  last_seen_at: number | null;
}

async function listTokens(mf: Miniflare, key: string): Promise<TokenRow[]> {
  const res = await mf.dispatchFetch('http://localhost/sync/tokens', { headers: { 'X-Sync-Key': key } });
  expect(res.status).toBe(200);
  return ((await res.json()) as { tokens: TokenRow[] }).tokens;
}

function rename(mf: Miniflare, headers: Record<string, string>, body: unknown): Promise<Awaited<ReturnType<Miniflare['dispatchFetch']>>> {
  return mf.dispatchFetch('http://localhost/sync/tokens', {
    method: 'PATCH',
    headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('token labels and listing', () => {
  it('stores a trimmed label given at redeem time', async () => {
    const { mf, key } = await setup('label-redeem');
    try {
      await pairedToken(mf, key, '  My laptop  ');
      await pairedToken(mf, key);
      const rows = await listTokens(mf, key);
      expect(rows.map((r) => r.label)).toEqual(['My laptop', null]);
    } finally {
      await mf.dispose();
    }
  });

  it('rejects an over-long or non-string label at redeem', async () => {
    const { mf, key } = await setup('label-bad---');
    try {
      for (const label of ['x'.repeat(65), 5]) {
        const minted = await mf.dispatchFetch('http://localhost/sync/tokens', { method: 'POST', headers: { 'X-Sync-Key': key } });
        const { code } = (await minted.json()) as { code: string };
        const res = await mf.dispatchFetch('http://localhost/sync/tokens/redeem', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ code, label }),
        });
        expect(res.status).toBe(400);
        expect(await res.json()).toMatchObject({ field: 'label' });
      }
      expect(await listTokens(mf, key)).toHaveLength(0);
    } finally {
      await mf.dispose();
    }
  });

  it('renames and clears a label with PATCH, master key only', async () => {
    const { mf, key, db } = await setup('label-patch-');
    try {
      const token = await pairedToken(mf, key, 'first');
      const other = makeSyncKey('label-other-');
      await register(mf, other);
      const [row] = await listTokens(mf, key);

      expect((await rename(mf, { 'X-Sync-Key': key }, { tokenId: row.token_id, label: '  Renamed ' })).status).toBe(204);
      expect((await listTokens(mf, key))[0].label).toBe('Renamed');
      expect((await rename(mf, { 'X-Sync-Key': key }, { tokenId: row.token_id, label: '' })).status).toBe(204);
      expect((await listTokens(mf, key))[0].label).toBeNull();

      expect((await rename(mf, { 'X-Sync-Key': key }, { tokenId: row.token_id, label: 'x'.repeat(65) })).status).toBe(400);
      expect((await rename(mf, { 'X-Sync-Key': key }, { tokenId: row.token_id })).status).toBe(400);
      expect((await rename(mf, { 'X-Sync-Key': key }, { label: 'a' })).status).toBe(400);
      expect((await rename(mf, { 'X-Sync-Key': key }, { tokenId: 'missing', label: 'a' })).status).toBe(404);
      expect((await rename(mf, { 'X-Sync-Key': other }, { tokenId: row.token_id, label: 'stolen' })).status).toBe(404);
      expect((await rename(mf, bearer(token), { tokenId: row.token_id, label: 'a' })).status).toBe(401);
      expect((await listTokens(mf, key))[0].label).toBeNull();
      void db;
    } finally {
      await mf.dispose();
    }
  });

  it('lists one row per grant with origin, scopes, client name and timestamps', async () => {
    const { mf, key, db } = await setup('list-grants-');
    try {
      const paired = await pairedToken(mf, key, 'siftctl');
      const { token, tokenId } = await oauthToken(db, key, { scopes: 'read' });
      await db.prepare('UPDATE tokens SET prev_refresh_hash = ? WHERE token_id = ?').bind('old', tokenId).run();
      await pull(mf, bearer(paired));
      await pull(mf, bearer(token));

      const rows = await listTokens(mf, key);
      expect(rows).toHaveLength(2);
      const oauth = rows.find((r) => r.origin === 'oauth')!;
      expect(oauth).toMatchObject({ token_id: tokenId, client_name: 'Test Agent', scopes: 'read', label: null });
      expect(oauth.created_at).toBeGreaterThan(1_000_000_000_000);
      expect(oauth.last_seen_at).not.toBeNull();
      expect(rows.find((r) => r.origin === 'paired')).toMatchObject({ label: 'siftctl', scopes: 'read write', client_name: null });
      expect(JSON.stringify(rows)).not.toContain(token);
    } finally {
      await mf.dispose();
    }
  });
});

describe('scope enforcement', () => {
  it('lets a read token pull and read items and statistics but not push', async () => {
    const { mf, key, db } = await setup('scope-read-');
    try {
      const { token } = await oauthToken(db, key, { scopes: 'read' });
      expect((await pull(mf, bearer(token))).status).toBe(200);
      expect((await mf.dispatchFetch('http://localhost/sync/stats/pull?since=0', { headers: bearer(token) })).status).toBe(200);
      expect((await push(mf, bearer(token), { feeds: [{ feedId: 'f1', feedUrl: 'https://ex.com/f', deleted: 0 }] })).status).toBe(403);
      expect(await count(db, 'SELECT COUNT(*) AS n FROM feeds WHERE sync_key = ?', key)).toBe(0);
    } finally {
      await mf.dispose();
    }
  });

  it('lets a read write token push, and a write-only token push but not pull', async () => {
    const { mf, key, db } = await setup('scope-write');
    try {
      const rw = await oauthToken(db, key, { scopes: 'read write' });
      expect((await push(mf, bearer(rw.token), { feeds: [{ feedId: 'f1', feedUrl: 'https://ex.com/f', deleted: 0 }] })).status).toBe(204);
      expect(await count(db, 'SELECT COUNT(*) AS n FROM feeds WHERE sync_key = ?', key)).toBe(1);

      const writeOnly = await oauthToken(db, key, { scopes: 'write' });
      expect((await push(mf, bearer(writeOnly.token), { feeds: [] })).status).toBe(204);
      expect((await pull(mf, bearer(writeOnly.token))).status).toBe(403);
    } finally {
      await mf.dispose();
    }
  });

  it('gives a token with no recognised scope no access', async () => {
    const { mf, key, db } = await setup('scope-none-');
    try {
      const { token } = await oauthToken(db, key, { scopes: '' });
      expect((await pull(mf, bearer(token))).status).toBe(403);
      expect((await push(mf, bearer(token), { feeds: [] })).status).toBe(403);
    } finally {
      await mf.dispose();
    }
  });

  it('parses scope strings defensively', () => {
    expect(parseScopes('read write')).toEqual(['read', 'write']);
    expect(parseScopes('write  read read admin')).toEqual(['write', 'read']);
    expect(parseScopes(null)).toEqual([]);
  });
});

describe('OAuth access token expiry', () => {
  it('rejects an expired access token with 401 and accepts a live one', async () => {
    const { mf, key, db } = await setup('expiry-----');
    try {
      const live = await oauthToken(db, key, { expiresAt: nowSeconds() + 60 });
      const expired = await oauthToken(db, key, { expiresAt: nowSeconds() - 1 });
      expect((await pull(mf, bearer(live.token))).status).toBe(200);
      expect((await pull(mf, bearer(expired.token))).status).toBe(401);
      expect((await pull(mf, { 'X-Sync-Key': expired.token })).status).toBe(401);
    } finally {
      await mf.dispose();
    }
  });

  it('never expires a paired token', async () => {
    const { mf, key, db } = await setup('expiry-pair');
    try {
      const token = await pairedToken(mf, key);
      const row = await db.prepare('SELECT origin, scopes, expires_at FROM tokens WHERE sync_key = ?').bind(key).first<{ origin: string; scopes: string; expires_at: number | null }>();
      expect(row).toEqual({ origin: 'paired', scopes: 'read write', expires_at: null });
      expect((await pull(mf, bearer(token))).status).toBe(200);
    } finally {
      await mf.dispose();
    }
  });
});

describe('rate-limit buckets', () => {
  it('names per-token buckets for OAuth principals and per-key buckets otherwise', () => {
    const master: SyncKeyContext = { syncKey: 'K', principal: { kind: 'master', syncKey: 'K', knownUser: true }, knownUser: true };
    const paired: SyncKeyContext = { syncKey: 'K', principal: { kind: 'token', syncKey: 'K', tokenId: 'T1', scopes: ['read'], origin: 'paired' }, knownUser: true };
    const oauth: SyncKeyContext = { syncKey: 'K', principal: { kind: 'token', syncKey: 'K', tokenId: 'T2', scopes: ['read'], origin: 'oauth' }, knownUser: true };
    expect(rateLimitKey(master, 'pull')).toBe('pull:K');
    expect(rateLimitKey(paired, 'pull')).toBe('pull:K');
    expect(rateLimitKey(oauth, 'pull')).toBe('pull:tok:T2');
    expect(RATE_LIMITS.discover.limit).toBeGreaterThan(0);
  });

  async function fill(db: D1, scope: string, limit: number): Promise<void> {
    const windowSeconds = RATE_LIMITS.pull.windowSeconds;
    const windowStart = Math.floor(nowSeconds() / windowSeconds) * windowSeconds;
    await db
      .prepare('INSERT INTO rate_limits (scope, window_start, count) VALUES (?, ?, ?)')
      .bind(scope, windowStart, limit)
      .run();
  }

  it('exhausting an OAuth token bucket leaves devices and other tokens unaffected', async () => {
    const { mf, key, db } = await setup('rl-oauth---');
    try {
      const a = await oauthToken(db, key);
      const b = await oauthToken(db, key);
      await fill(db, `pull:tok:${a.tokenId}`, RATE_LIMITS.pull.limit);
      expect((await pull(mf, bearer(a.token))).status).toBe(429);
      expect((await pull(mf, bearer(b.token))).status).toBe(200);
      expect((await pull(mf, { 'X-Sync-Key': key })).status).toBe(200);
    } finally {
      await mf.dispose();
    }
  });

  it('exhausting the per-key bucket limits devices and paired tokens but not OAuth tokens', async () => {
    const { mf, key, db } = await setup('rl-shared--');
    try {
      const paired = await pairedToken(mf, key);
      const oauth = await oauthToken(db, key);
      await fill(db, `pull:${key}`, RATE_LIMITS.pull.limit);
      expect((await pull(mf, { 'X-Sync-Key': key })).status).toBe(429);
      expect((await pull(mf, bearer(paired))).status).toBe(429);
      expect((await pull(mf, bearer(oauth.token))).status).toBe(200);
    } finally {
      await mf.dispose();
    }
  });

  it('writes OAuth requests to the token bucket rather than the key bucket', async () => {
    const { mf, key, db } = await setup('rl-writes--');
    try {
      const { token, tokenId } = await oauthToken(db, key);
      expect((await pull(mf, bearer(token))).status).toBe(200);
      expect(await count(db, 'SELECT COUNT(*) AS n FROM rate_limits WHERE scope = ?', `pull:tok:${tokenId}`)).toBe(1);
      expect(await count(db, 'SELECT COUNT(*) AS n FROM rate_limits WHERE scope = ?', `pull:${key}`)).toBe(0);
    } finally {
      await mf.dispose();
    }
  });
});

describe('push behaviour after the shared merge refactor', () => {
  it('still validates payloads, stamps writes and revives tombstones', async () => {
    const { mf, key } = await setup('push-same--');
    try {
      const auth = { 'X-Sync-Key': key };
      const bad = await push(mf, auth, { feeds: [{ feedId: '', feedUrl: 'https://ex.com/f' }] });
      expect(bad.status).toBe(400);
      expect(await bad.json()).toMatchObject({ field: 'feedId' });
      expect((await push(mf, auth, {})).status).toBe(204);

      const itemId = `${encodeURIComponent('feed-a')}::g1`;
      expect((await push(mf, auth, {
        feeds: [{ feedId: 'feed-a', feedUrl: 'https://ex.com/a', title: 'A', tags: ['x'], deleted: 0 }],
        flags: [{ itemId, feedId: 'feed-a', read: 1, starred: 1 }],
      })).status).toBe(204);
      expect((await push(mf, auth, { feeds: [{ feedId: 'feed-a', deleted: 1 }] })).status).toBe(204);
      expect((await push(mf, auth, { feeds: [{ feedId: 'feed-b', feedUrl: 'https://ex.com/a', deleted: 0 }] })).status).toBe(204);

      const body = (await (await pull(mf, auth)).json()) as {
        feeds: Array<{ feed_id: string; deleted: number; title: string }>;
        flags: Array<{ item_id: string; read: number; starred: number }>;
      };
      expect(body.feeds).toHaveLength(1);
      expect(body.feeds[0]).toMatchObject({ feed_id: 'feed-a', deleted: 0, title: 'A' });
      expect(body.flags).toMatchObject([{ item_id: itemId, read: 1, starred: 1 }]);
    } finally {
      await mf.dispose();
    }
  });
});

const migrationsDir = path.resolve(__dirname, '../server/migrations');
const migrationFiles = readdirSync(migrationsDir).filter((f) => /^\d{4}_.*\.sql$/.test(f)).sort();

async function applyMigrations(db: D1, files: string[]): Promise<void> {
  for (const file of files) {
    const sql = readFileSync(path.join(migrationsDir, file), 'utf8')
      .split('\n')
      .filter((line) => !line.trimStart().startsWith('--'))
      .join('\n');
    const statements = sql.split(';').map((s) => s.trim()).filter(Boolean);
    await db.batch(statements.map((s) => db.prepare(s)));
  }
}

describe('agent connector migration', () => {
  it('backfills existing tokens as paired with read write scopes', async () => {
    const mf = await createMf();
    try {
      const db = await mf.getD1Database('DB');
      const connectorMigration = migrationFiles.find((f) => f.includes('agent_connector'));
      expect(connectorMigration).toBeDefined();
      await applyMigrations(db, migrationFiles.filter((f) => f < connectorMigration!));
      await db
        .prepare("INSERT INTO tokens (token_id, token_hash, sync_key, scope, fingerprint, created_at) VALUES ('t1', 'h1', 'k1', 'rw', 'ABCD', 1)")
        .run();

      await applyMigrations(db, [connectorMigration!]);

      expect(await db.prepare('SELECT origin, scopes, client_id, client_name, refresh_hash, refresh_expires_at, expires_at, family_id FROM tokens WHERE token_id = ?').bind('t1').first()).toEqual({
        origin: 'paired',
        scopes: 'read write',
        client_id: null,
        client_name: null,
        refresh_hash: null,
        refresh_expires_at: null,
        expires_at: null,
        family_id: null,
      });
      for (const table of ['oauth_clients', 'oauth_connections', 'oauth_requests', 'oauth_codes']) {
        expect(await count(db, `SELECT COUNT(*) AS n FROM ${table}`)).toBe(0);
      }
    } finally {
      await mf.dispose();
    }
  });

  it('produces the same oauth tables and token columns as the runtime schema', async () => {
    const fromMigrations = await createMf();
    const fromRuntime = await createMf();
    try {
      const migrated = await fromMigrations.getD1Database('DB');
      await applyMigrations(migrated, migrationFiles);
      await register(fromRuntime, makeSyncKey('schema-same'));
      const runtime = await fromRuntime.getD1Database('DB');
      const columns = async (db: D1, table: string) =>
        (await db.prepare(`SELECT name FROM pragma_table_info('${table}')`).all<{ name: string }>()).results.map((r) => r.name).sort();
      for (const table of ['oauth_clients', 'oauth_connections', 'oauth_requests', 'oauth_codes', 'tokens']) {
        expect(await columns(migrated, table), table).toEqual(await columns(runtime, table));
      }
    } finally {
      await fromMigrations.dispose();
      await fromRuntime.dispose();
    }
  });
});

describe('scheduled cleanup and account deletion', () => {
  async function seedOAuthRows(db: D1, key: string, offset: number): Promise<void> {
    const now = nowSeconds();
    const at = now + offset;
    const suffix = offset < 0 ? 'old' : 'new';
    await db.prepare('INSERT INTO oauth_connections (connection_id, sync_key, created_at, expires_at) VALUES (?, ?, ?, ?)').bind(`conn-${suffix}`, key, now - 1000, at).run();
    await db
      .prepare('INSERT INTO oauth_requests (request_id, approval_code, client_id, redirect_uri, code_challenge, scopes, sync_key, decision, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .bind(`req-${suffix}`, `code-${suffix}`, 'client-1', 'https://ex.com/cb', 'challenge', 'read', key, 'approved', now - 1000, at)
      .run();
    await db
      .prepare('INSERT INTO oauth_codes (code_hash, client_id, redirect_uri, code_challenge, scopes, sync_key, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
      .bind(`hash-${suffix}`, 'client-1', 'https://ex.com/cb', 'challenge', 'read', key, now - 1000, at)
      .run();
  }

  async function runCron(mf: Miniflare): Promise<void> {
    const worker = await mf.getWorker();
    const result = await worker.scheduled({ cron: '0 3 * * *', scheduledTime: new Date() });
    expect(result.outcome).toBe('ok');
  }

  it('sweeps expired OAuth rows and refresh-expired grants but keeps live ones', async () => {
    const { mf, key, db } = await setup('cleanup----');
    try {
      await seedOAuthRows(db, key, -10);
      await seedOAuthRows(db, key, 3600);
      const paired = await pairedToken(mf, key);
      const stale = await oauthToken(db, key, { expiresAt: nowSeconds() - 5000, refreshExpiresAt: nowSeconds() - 10 });
      const idleAccess = await oauthToken(db, key, { expiresAt: nowSeconds() - 5000, refreshExpiresAt: nowSeconds() + 3600 });
      await db.prepare("INSERT INTO oauth_clients (client_id, client_name, redirect_uris, kind, created_at, expires_at) VALUES ('c-expired', 'X', '[]', 'metadata', 1, ?)").bind(nowSeconds() - 10).run();
      await db.prepare("INSERT INTO oauth_clients (client_id, client_name, redirect_uris, kind, created_at, expires_at) VALUES ('client-1', 'Y', '[]', 'metadata', 1, ?)").bind(nowSeconds() - 10).run();
      await db.prepare("INSERT INTO oauth_clients (client_id, client_name, redirect_uris, kind, created_at) VALUES ('c-registered', 'Z', '[]', 'registered', 1)").run();

      await runCron(mf);

      expect(await count(db, "SELECT COUNT(*) AS n FROM oauth_connections WHERE connection_id = 'conn-old'")).toBe(0);
      expect(await count(db, "SELECT COUNT(*) AS n FROM oauth_connections WHERE connection_id = 'conn-new'")).toBe(1);
      expect(await count(db, "SELECT COUNT(*) AS n FROM oauth_requests WHERE request_id = 'req-old'")).toBe(0);
      expect(await count(db, "SELECT COUNT(*) AS n FROM oauth_requests WHERE request_id = 'req-new'")).toBe(1);
      expect(await count(db, "SELECT COUNT(*) AS n FROM oauth_codes WHERE code_hash = 'hash-old'")).toBe(0);
      expect(await count(db, "SELECT COUNT(*) AS n FROM oauth_codes WHERE code_hash = 'hash-new'")).toBe(1);
      expect(await count(db, 'SELECT COUNT(*) AS n FROM tokens WHERE token_id = ?', stale.tokenId)).toBe(0);
      expect(await count(db, 'SELECT COUNT(*) AS n FROM tokens WHERE token_id = ?', idleAccess.tokenId)).toBe(1);
      expect(await count(db, "SELECT COUNT(*) AS n FROM tokens WHERE origin = 'paired' AND sync_key = ?", key)).toBe(1);
      expect(await count(db, "SELECT COUNT(*) AS n FROM oauth_clients WHERE client_id = 'c-expired'")).toBe(0);
      expect(await count(db, "SELECT COUNT(*) AS n FROM oauth_clients WHERE client_id = 'client-1'")).toBe(1);
      expect(await count(db, "SELECT COUNT(*) AS n FROM oauth_clients WHERE client_id = 'c-registered'")).toBe(1);
      expect((await pull(mf, bearer(paired))).status).toBe(200);
    } finally {
      await mf.dispose();
    }
  });

  it('removes OAuth rows with the account', async () => {
    const { mf, key, db } = await setup('acct-delete-');
    try {
      await seedOAuthRows(db, key, 3600);
      const { token } = await oauthToken(db, key);
      const res = await mf.dispatchFetch('http://localhost/sync/account', { method: 'DELETE', headers: { 'X-Sync-Key': key } });
      expect(res.status).toBe(204);
      for (const table of ['oauth_connections', 'oauth_requests', 'oauth_codes']) {
        expect(await count(db, `SELECT COUNT(*) AS n FROM ${table} WHERE sync_key = ?`, key), table).toBe(0);
      }
      expect((await pull(mf, bearer(token))).status).toBe(401);
    } finally {
      await mf.dispose();
    }
  });
});
