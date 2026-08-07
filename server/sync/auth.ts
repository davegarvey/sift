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
import { sha256Hex, isValidTokenFormat } from './tokens';

export const KEY_FORMAT_RE = /^[A-Za-z0-9_-]{22}$/;

export type Principal =
  | { kind: 'master'; syncKey: string; knownUser: boolean }
  | { kind: 'token'; syncKey: string; tokenId: string };

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
    .prepare('SELECT sync_key FROM users WHERE sync_key = ?')
    .bind(syncKey)
    .first<{ sync_key: string }>();
  if (!existing) {
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

export function getSyncKeyContext(c: Context<SyncKeyEnv>): SyncKeyContext {
  const ctx = c.get('syncKeyCtx');
  if (!ctx) {
    throw new Error('syncKeyCtx not set — requireSyncKey middleware not run');
  }
  return ctx;
}
