/**
 * Bearer-token authentication for sync data routes.
 *
 * Validates the `X-Sync-Key` header against the format regex and looks up
 * the corresponding row in `users`. Unknown / missing / malformed keys
 * return 401.
 *
 * The auth check is the only place a sync key is read from the request —
 * route handlers receive the validated key via the context, and MUST NOT
 * re-read the header.
 */

import type { Context, MiddlewareHandler } from 'hono';
import { assertNoKeyLog } from '../log';
import { checkMemoryRateLimit } from './ratelimit';
import { sha256Hex, isValidTokenFormat } from './tokens';

export const KEY_FORMAT_RE = /^[A-Za-z0-9_-]{22}$/;

export const PAIRING_ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789';
export const PAIRING_CODE_LEN = 8;

export function generatePairingCode(): string {
  const bytes = new Uint8Array(PAIRING_CODE_LEN);
  crypto.getRandomValues(bytes);
  let s = '';
  for (let i = 0; i < PAIRING_CODE_LEN; i++) {
    s += PAIRING_ALPHABET[bytes[i] % PAIRING_ALPHABET.length];
  }
  return s;
}

export function isPairingCode(s: string): boolean {
  if (s.length !== PAIRING_CODE_LEN) return false;
  for (const ch of s) {
    if (!PAIRING_ALPHABET.includes(ch)) return false;
  }
  return true;
}

export function clientIp(c: Context): string {
  return c.req.header('cf-connecting-ip') ?? c.req.header('x-forwarded-for') ?? '0.0.0.0';
}

export type Principal =
  | { kind: 'master'; syncKey: string; knownUser: boolean }
  | { kind: 'token'; syncKey: string; tokenId: string }
  | { kind: 'code'; syncKey: string };

export interface SyncKeyContext {
  syncKey: string;
  principal: Principal;
  /** True if the user row existed before this request. False on lazy creation. */
  knownUser: boolean;
}

export function isValidSyncKey(s: string | undefined | null): s is string {
  return typeof s === 'string' && KEY_FORMAT_RE.test(s);
}

export interface SyncKeyEnv {
  Variables: { syncKeyCtx: SyncKeyContext };
}

type AuthResult = { ok: true; ctx: SyncKeyContext } | { ok: false; response: Response };

async function authenticate(db: D1Database, c: Context<SyncKeyEnv>): Promise<AuthResult> {
  const raw = c.req.header('X-Sync-Key');
  if (typeof raw === 'string' && isValidTokenFormat(raw)) {
    const tokenHash = await sha256Hex(raw);
    const row = await db
      .prepare('SELECT token_id, sync_key, last_seen_minute FROM tokens WHERE token_hash = ?')
      .bind(tokenHash)
      .first<{ token_id: string; sync_key: string; last_seen_minute: number | null }>();
    if (!row) {
      assertNoKeyLog(raw);
      return { ok: false, response: c.text('Unauthorized', 401) };
    }
    // Rotation orphans tokens: a token whose sync key was rotated away is
    // rejected, as is a token whose sync key no longer exists at all.
    const user = await db
      .prepare('SELECT sync_key, rotated_at FROM users WHERE sync_key = ?')
      .bind(row.sync_key)
      .first<{ sync_key: string; rotated_at: number | null }>();
    if (!user || user.rotated_at !== null) {
      assertNoKeyLog(raw);
      return { ok: false, response: c.text('Unauthorized', 401) };
    }
    const minute = Math.floor(Date.now() / 60_000);
    if (row.last_seen_minute !== minute) {
      await db
        .prepare('UPDATE tokens SET last_seen_at = ?, last_seen_minute = ? WHERE token_id = ?')
        .bind(Date.now(), minute, row.token_id)
        .run();
    }
    return {
      ok: true,
      ctx: {
        syncKey: row.sync_key,
        principal: { kind: 'token', syncKey: row.sync_key, tokenId: row.token_id },
        knownUser: true,
      },
    };
  }

  if (!isValidSyncKey(raw)) {
    assertNoKeyLog(raw ?? '(missing)');
    return { ok: false, response: c.text('Unauthorized', 401) };
  }
  const syncKey = raw;
  const existing = await db
    .prepare('SELECT sync_key, rotated_at FROM users WHERE sync_key = ?')
    .bind(syncKey)
    .first<{ sync_key: string; rotated_at: number | null }>();
  if (!existing) {
    assertNoKeyLog(syncKey);
    return { ok: false, response: c.text('Unauthorized', 401) };
  }
  if (existing.rotated_at !== null) {
    assertNoKeyLog(syncKey);
    return { ok: false, response: c.text('Unauthorized', 401) };
  }
  return {
    ok: true,
    ctx: { syncKey, principal: { kind: 'master', syncKey, knownUser: true }, knownUser: true },
  };
}

/**
 * Principal-aware middleware that validates the X-Sync-Key header.
 *
 * The credential format disambiguates the principal type:
 * - 22-character master keys → `users` lookup (existing behavior)
 * - `t`-prefixed 23-character agent tokens → `tokens` lookup by SHA-256 hash
 *
 * Token principals are valid on any route mounted with this middleware;
 * master-key-only routes use `requireMaster`. Returns 401 on any failure.
 */
export function requirePrincipal(db: D1Database): MiddlewareHandler<SyncKeyEnv> {
  return async (c, next) => {
    const result = await authenticate(db, c);
    if (!result.ok) return result.response;
    c.set('syncKeyCtx', result.ctx);
    return next();
  };
}

/**
 * Master-key-only middleware: requires a master principal (agent tokens 401).
 * Mounted on routes whose actions must never be reachable with a token
 * (`/sync/otp` — a device code redeems to the master key — `/sync/register`,
 * and the token lifecycle routes).
 */
export function requireMaster(db: D1Database): MiddlewareHandler<SyncKeyEnv> {
  return async (c, next) => {
    const result = await authenticate(db, c);
    if (!result.ok) return result.response;
    if (result.ctx.principal.kind !== 'master') {
      assertNoKeyLog(result.ctx.syncKey);
      return c.text('Unauthorized', 401);
    }
    c.set('syncKeyCtx', result.ctx);
    return next();
  };
}

const CODE_PULL_IP_WINDOW = 60;
const CODE_PULL_IP_LIMIT = 60;
const CODE_PULL_PAIR_WINDOW = 60;
const CODE_PULL_PAIR_LIMIT = 10;

function codePullResponse(status: 404 | 429, retryAfter?: number): Response {
  const headers: Record<string, string> = { 'Cache-Control': 'no-store' };
  if (retryAfter !== undefined) headers['Retry-After'] = String(retryAfter);
  return new Response(null, { status, headers });
}

/**
 * Auth for `/sync/pull`: accepts the `X-Sync-Key` header (master or agent
 * token) or an agent pairing code in the `code` query parameter. Code
 * principals are read-only by construction — this middleware is mounted on
 * the pull route only, never on write routes.
 *
 * Code attempts are brute-force-guarded in memory (per IP and per IP+code)
 * BEFORE any database lookup; the guards write nothing to persistent
 * storage, so a guessing campaign cannot drain the D1 write quota.
 */
export function requirePullPrincipal(db: D1Database): MiddlewareHandler<SyncKeyEnv> {
  return async (c, next) => {
    const result = await authenticate(db, c);
    if (result.ok) {
      c.set('syncKeyCtx', result.ctx);
      return next();
    }

    const code = c.req.query('code');
    if (typeof code !== 'string') {
      return result.response;
    }
    const ip = clientIp(c);
    const ipRl = checkMemoryRateLimit(`code-pull:ip:${ip}`, CODE_PULL_IP_WINDOW, CODE_PULL_IP_LIMIT);
    if (!ipRl.ok) return codePullResponse(429, ipRl.retryAfter);
    if (!isPairingCode(code)) {
      return codePullResponse(404);
    }
    const pairRl = checkMemoryRateLimit(`code-pull:pair:${ip}:${code}`, CODE_PULL_PAIR_WINDOW, CODE_PULL_PAIR_LIMIT);
    if (!pairRl.ok) return codePullResponse(429, pairRl.retryAfter);

    const row = await db
      .prepare('SELECT sync_key, expires_at FROM pairing_codes WHERE code = ? AND kind = ?')
      .bind(code, 'agent')
      .first<{ sync_key: string; expires_at: number }>();
    if (!row) {
      return codePullResponse(404);
    }
    if (row.expires_at <= Date.now() / 1000) {
      // Lazy expiry cleanup — the code is not consumed on success (multi-use).
      await db.prepare('DELETE FROM pairing_codes WHERE code = ?').bind(code).run();
      return codePullResponse(404);
    }
    assertNoKeyLog(row.sync_key);
    c.set('syncKeyCtx', {
      syncKey: row.sync_key,
      principal: { kind: 'code', syncKey: row.sync_key },
      knownUser: true,
    });
    return next();
  };
}

export function getSyncKeyContext(c: Context<SyncKeyEnv>): SyncKeyContext {
  const ctx = c.get('syncKeyCtx');
  if (!ctx) {
    throw new Error('syncKeyCtx not set — requireSyncKey middleware not run');
  }
  return ctx;
}
