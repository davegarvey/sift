/**
 * Bearer-token authentication for sync data routes.
 *
 * Validates the `X-Sync-Key` header (master key or agent token) or an
 * `Authorization: Bearer` agent token. Master keys are looked up in `users`,
 * tokens by SHA-256 hash in `tokens`. Unknown / missing / malformed
 * credentials return 401.
 *
 * The auth check is the only place a sync key is read from the request —
 * route handlers receive the validated key via the context, and MUST NOT
 * re-read the header.
 */

import type { Context, MiddlewareHandler } from 'hono';
import { assertNoKeyLog } from '../log';
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
  return c.req.header('cf-connecting-ip') ?? '0.0.0.0';
}

export type Scope = 'read' | 'write';
export type TokenOrigin = 'paired' | 'oauth';

export type Principal =
  | { kind: 'master'; syncKey: string; knownUser: boolean }
  | { kind: 'token'; syncKey: string; tokenId: string; scopes: Scope[]; origin: TokenOrigin };

export interface TokenAuth {
  syncKey: string;
  tokenId: string;
  scopes: Scope[];
  origin: TokenOrigin;
}

export function parseScopes(raw: string | null | undefined): Scope[] {
  const scopes: Scope[] = [];
  for (const part of (raw ?? '').split(/\s+/)) {
    if ((part === 'read' || part === 'write') && !scopes.includes(part)) scopes.push(part);
  }
  return scopes;
}

export function hasScope(scopes: readonly Scope[], required: Scope): boolean {
  return scopes.includes(required);
}

export async function authenticateToken(db: D1Database, raw: string): Promise<TokenAuth | null> {
  if (!isValidTokenFormat(raw)) return null;
  const tokenHash = await sha256Hex(raw);
  const row = await db
    .prepare('SELECT token_id, sync_key, last_seen_minute, scopes, origin, expires_at FROM tokens WHERE token_hash = ?')
    .bind(tokenHash)
    .first<{
      token_id: string;
      sync_key: string;
      last_seen_minute: number | null;
      scopes: string | null;
      origin: string | null;
      expires_at: number | null;
    }>();
  if (!row) return null;
  if (row.expires_at !== null && row.expires_at !== undefined && row.expires_at <= Math.floor(Date.now() / 1000)) {
    return null;
  }
  // Rotation orphans tokens: a token whose sync key was rotated away is
  // rejected, as is a token whose sync key no longer exists at all.
  const user = await db
    .prepare('SELECT sync_key, rotated_at FROM users WHERE sync_key = ?')
    .bind(row.sync_key)
    .first<{ sync_key: string; rotated_at: number | null }>();
  if (!user || user.rotated_at !== null) return null;
  const minute = Math.floor(Date.now() / 60_000);
  if (row.last_seen_minute !== minute) {
    await db
      .prepare('UPDATE tokens SET last_seen_at = ?, last_seen_minute = ? WHERE token_id = ?')
      .bind(Date.now(), minute, row.token_id)
      .run();
  }
  return {
    syncKey: row.sync_key,
    tokenId: row.token_id,
    scopes: parseScopes(row.scopes),
    origin: row.origin === 'oauth' ? 'oauth' : 'paired',
  };
}

export function rateLimitKey(ctx: SyncKeyContext, prefix: string): string {
  const principal = ctx.principal;
  if (principal.kind === 'token' && principal.origin === 'oauth') {
    return `${prefix}:tok:${principal.tokenId}`;
  }
  return `${prefix}:${ctx.syncKey}`;
}

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

function tokenContext(auth: TokenAuth): SyncKeyContext {
  return {
    syncKey: auth.syncKey,
    principal: { kind: 'token', syncKey: auth.syncKey, tokenId: auth.tokenId, scopes: auth.scopes, origin: auth.origin },
    knownUser: true,
  };
}

type AuthResult = { ok: true; ctx: SyncKeyContext } | { ok: false; response: Response };

async function authenticate(db: D1Database, c: Context<SyncKeyEnv>): Promise<AuthResult> {
  const bearerMatch = /^Bearer\s+(\S+)$/i.exec(c.req.header('Authorization') ?? '');
  if (bearerMatch) {
    const bearer = bearerMatch[1];
    const auth = await authenticateToken(db, bearer);
    if (!auth) {
      assertNoKeyLog(bearer);
      return { ok: false, response: c.text('Unauthorized', 401) };
    }
    return { ok: true, ctx: tokenContext(auth) };
  }

  const raw = c.req.header('X-Sync-Key');
  if (typeof raw === 'string' && isValidTokenFormat(raw)) {
    const auth = await authenticateToken(db, raw);
    if (!auth) {
      assertNoKeyLog(raw);
      return { ok: false, response: c.text('Unauthorized', 401) };
    }
    return { ok: true, ctx: tokenContext(auth) };
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
 * - 22-character master keys (`X-Sync-Key` only) → `users` lookup
 * - `t`-prefixed 23-character agent tokens (`Authorization: Bearer` or
 *   `X-Sync-Key`) → `tokens` lookup by SHA-256 hash; expired OAuth access
 *   tokens fail
 *
 * Token principals are valid on any route mounted with this middleware;
 * scope-limited routes add `requireScope` and master-key-only routes use
 * `requireMaster`. Returns 401 on any failure.
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

/**
 * Scope gate for token principals, mounted after `requirePrincipal`. Master
 * keys hold every scope; a token without the scope receives 403.
 */
export function requireScope(scope: Scope): MiddlewareHandler<SyncKeyEnv> {
  return async (c, next) => {
    const { principal } = getSyncKeyContext(c);
    if (principal.kind === 'token' && !hasScope(principal.scopes, scope)) {
      return c.text('Forbidden', 403);
    }
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
