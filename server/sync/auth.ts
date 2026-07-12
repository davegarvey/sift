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

export const KEY_FORMAT_RE = /^[A-Za-z0-9_-]{22}$/;

export interface SyncKeyContext {
  syncKey: string;
  /** True if the user row existed before this request. False on lazy creation. */
  knownUser: boolean;
}

export function isValidSyncKey(s: string | undefined | null): s is string {
  return typeof s === 'string' && KEY_FORMAT_RE.test(s);
}

export interface SyncKeyEnv {
  Variables: { syncKeyCtx: SyncKeyContext };
}

/**
 * Hono middleware that validates the X-Sync-Key header and looks up the
 * user. Returns 401 on any failure.
 */
export function requireSyncKey(db: D1Database): MiddlewareHandler<SyncKeyEnv> {
  return async (c, next) => {
    const raw = c.req.header('X-Sync-Key');
    if (!isValidSyncKey(raw)) {
      assertNoKeyLog(raw ?? '(missing)');
      return c.text('Unauthorized', 401);
    }
    const syncKey = raw;
    const existing = await db
      .prepare('SELECT sync_key FROM users WHERE sync_key = ?')
      .bind(syncKey)
      .first<{ sync_key: string }>();
    if (!existing) {
      assertNoKeyLog(syncKey);
      return c.text('Unauthorized', 401);
    }
    c.set('syncKeyCtx', { syncKey, knownUser: true });
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
