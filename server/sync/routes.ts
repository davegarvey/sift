/**
 * Sync HTTP routes.
 *
 * Registered behind a Hono factory. The Worker passes the D1 binding;
 * Node/Bun adapters don't (sync is Workers-only).
 *
 * CORS: no `Access-Control-Allow-Origin` is set on any /sync/* route.
 * Preflight OPTIONS is rejected with 403. Sync is same-origin only.
 */

import { Hono, type Context } from 'hono';
import { requireSyncKey, getSyncKeyContext, isValidSyncKey, type SyncKeyEnv } from './auth';
import { RATE_LIMITS, checkRateLimit } from './ratelimit';
import { nextMonotonicTime, currentMonotonicTime } from './monotonic';
import { ensureSchema } from './schema';
import { assertNoKeyLog, assertNoUserDataLog, assertNoUrlLog } from '../log';

const PAIRING_ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789';
const PAIRING_CODE_LEN = 8;
const PAIRING_TTL_SECONDS = 5 * 60;
const MAX_USERS = 100_000;

interface FeedPayload {
  feedId: string;
  feedUrl?: { value: string; at: number };
  folder?: { value: string[] | null; at: number };
  title?: { value: string; at: number };
  tags?: { value: string[] | null; at: number };
  deleted?: { value: 0 | 1; at: number };
}

interface FlagPayload {
  itemId: string;
  feedId: string;
  read?: { value: 0 | 1 | null; at: number };
  starred?: { value: 0 | 1 | null; at: number };
}

interface PushBody {
  feeds?: FeedPayload[];
  flags?: FlagPayload[];
}

function clientIp(c: Context): string {
  return c.req.header('cf-connecting-ip') ?? c.req.header('x-forwarded-for') ?? '0.0.0.0';
}

function rateLimitResponse(scope: string, limitKey: string, retryAfter: number, status: 429 | 503 = 429): Response {
  return new Response(null, {
    status,
    headers: { 'Retry-After': String(retryAfter) },
  });
}

function generatePairingCode(): string {
  const bytes = new Uint8Array(PAIRING_CODE_LEN);
  crypto.getRandomValues(bytes);
  let s = '';
  for (let i = 0; i < PAIRING_CODE_LEN; i++) {
    s += PAIRING_ALPHABET[bytes[i] % PAIRING_ALPHABET.length];
  }
  return s;
}

function isPairingCode(s: string): boolean {
  if (s.length !== PAIRING_CODE_LEN) return false;
  for (const ch of s) {
    if (!PAIRING_ALPHABET.includes(ch)) return false;
  }
  return true;
}

function deriveFeedIdFromItemId(itemId: string): string | null {
  const lastSep = itemId.lastIndexOf('::');
  if (lastSep === -1) return null;
  try {
    return decodeURIComponent(itemId.slice(0, lastSep));
  } catch {
    return null;
  }
}

function jsonError(message: string, fieldName?: string, fieldValue?: unknown): Response {
  const body: Record<string, unknown> = { error: message };
  if (fieldName) body.field = fieldName;
  // fieldValue is intentionally NOT included — do not echo user input in errors.
  assertNoUserDataLog('error_body', body);
  return new Response(JSON.stringify(body), {
    status: 400,
    headers: { 'Content-Type': 'application/json' },
  });
}

export interface SyncRoutesOptions {
  nowSeconds?: () => number;
}

export function createSyncRoutes(db: D1Database, opts: SyncRoutesOptions = {}): Hono<SyncKeyEnv> {
  const app = new Hono<SyncKeyEnv>();
  const now = opts.nowSeconds ?? (() => Math.floor(Date.now() / 1000));

  // Reject CORS preflight on all sync routes.
  app.options('*', (c) => c.text('Forbidden', 403));

  // Bootstrap schema on first request (idempotent).
  let schemaReady: Promise<void> | null = null;
  app.use('*', async (_c, next) => {
    if (!schemaReady) schemaReady = ensureSchema(db);
    await schemaReady;
    return next();
  });

  // Capabilities — public, no auth.
  app.get('/sync/capabilities', (c) => c.json({ sync: true }));

  // POST /sync/register — explicit user creation.
  app.post('/sync/register', async (c) => {
    const raw = c.req.header('X-Sync-Key');
    if (!isValidSyncKey(raw)) {
      assertNoKeyLog(raw ?? '(missing)');
      return c.text('Unauthorized', 401);
    }
    const syncKey = raw;
    const ip = clientIp(c);

    // Check 1: global daily registration cap.
    const globalRl = await checkRateLimit(
      db,
      'register:global',
      RATE_LIMITS.registerGlobal.windowSeconds,
      RATE_LIMITS.registerGlobal.limit,
      now(),
    );
    if (!globalRl.ok) {
      return rateLimitResponse('register:global', ip, globalRl.retryAfter, 503);
    }

    // Check 2: per-IP rate limit.
    const ipRl = await checkRateLimit(
      db,
      `register:${ip}`,
      RATE_LIMITS.registerPerIp.windowSeconds,
      RATE_LIMITS.registerPerIp.limit,
      now(),
    );
    if (!ipRl.ok) {
      return rateLimitResponse(`register:${ip}`, ip, ipRl.retryAfter, 429);
    }

    // Check 3: hard users row count cap.
    const countRow = await db
      .prepare('SELECT COUNT(*) AS n FROM users')
      .first<{ n: number }>();
    if (countRow && countRow.n >= MAX_USERS) {
      return new Response('Service at capacity', { status: 503 });
    }

    // Lazy create (idempotent).
    await db
      .prepare('INSERT OR IGNORE INTO users (sync_key, created_at) VALUES (?, ?)')
      .bind(syncKey, now())
      .run();

    return c.body(null, 204);
  });

  // Authenticated data routes.
  const auth = requireSyncKey(db);
  app.use('/sync/otp', auth);
  app.use('/sync/push', auth);
  app.use('/sync/pull', auth);

  // POST /sync/otp — issue a pairing code (server-generated).
  app.post('/sync/otp', async (c) => {
    const { syncKey } = getSyncKeyContext(c);

    const rl = await checkRateLimit(
      db,
      `otp:${syncKey}`,
      RATE_LIMITS.otp.windowSeconds,
      RATE_LIMITS.otp.limit,
      now(),
    );
    if (!rl.ok) {
      return rateLimitResponse(`otp:${syncKey}`, syncKey, rl.retryAfter, 429);
    }

    // Generate a unique code (max 5 attempts).
    const expiresAt = now() + PAIRING_TTL_SECONDS;
    let code = '';
    for (let attempt = 0; attempt < 5; attempt++) {
      const candidate = generatePairingCode();
      try {
        await db
          .prepare('INSERT INTO pairing_codes (code, sync_key, expires_at) VALUES (?, ?, ?)')
          .bind(candidate, syncKey, expiresAt)
          .run();
        code = candidate;
        break;
      } catch (err) {
        // Unique constraint violation → retry with a new code.
        if (!String(err).includes('UNIQUE')) {
          throw err;
        }
      }
    }
    if (!code) {
      return new Response('Internal Server Error', { status: 500 });
    }

    return c.json({ code, expiresAt: expiresAt * 1000 });
  });

  // POST /sync/redeem — exchange a pairing code for the sync key.
  app.post('/sync/redeem', async (c) => {
    const ip = clientIp(c);
    const rl = await checkRateLimit(
      db,
      `redeem:${ip}`,
      RATE_LIMITS.redeem.windowSeconds,
      RATE_LIMITS.redeem.limit,
      now(),
    );
    if (!rl.ok) {
      return rateLimitResponse(`redeem:${ip}`, ip, rl.retryAfter, 429);
    }

    let body: { code?: unknown };
    try {
      body = await c.req.json();
    } catch {
      return jsonError('Invalid JSON body', 'body');
    }
    const code = typeof body.code === 'string' ? body.code : '';
    if (!isPairingCode(code)) {
      return jsonError('Invalid pairing code', 'code');
    }

    const row = await db
      .prepare('SELECT sync_key, expires_at FROM pairing_codes WHERE code = ?')
      .bind(code)
      .first<{ sync_key: string; expires_at: number }>();

    if (!row) {
      return c.text('Not Found', 404);
    }
    if (row.expires_at <= now()) {
      await db.prepare('DELETE FROM pairing_codes WHERE code = ?').bind(code).run();
      return c.text('Not Found', 404);
    }

    // One-time use.
    await db.prepare('DELETE FROM pairing_codes WHERE code = ?').bind(code).run();
    assertNoKeyLog(row.sync_key);
    return c.json({ syncKey: row.sync_key });
  });

  // POST /sync/push — apply PATCH semantics to feeds and flags.
  app.post('/sync/push', async (c) => {
    const { syncKey } = getSyncKeyContext(c);

    const rl = await checkRateLimit(
      db,
      `push:${syncKey}`,
      RATE_LIMITS.push.windowSeconds,
      RATE_LIMITS.push.limit,
      now(),
    );
    if (!rl.ok) {
      return rateLimitResponse(`push:${syncKey}`, syncKey, rl.retryAfter, 429);
    }

    let body: PushBody;
    try {
      body = (await c.req.json()) as PushBody;
    } catch {
      return jsonError('Invalid JSON body', 'body');
    }
    const feeds = Array.isArray(body.feeds) ? body.feeds : [];
    const flags = Array.isArray(body.flags) ? body.flags : [];
    if (feeds.length === 0 && flags.length === 0) {
      return c.body(null, 204);
    }

    // Per-user row cap check.
    const [feedCount, flagCount] = await Promise.all([
      db.prepare('SELECT COUNT(*) AS n FROM feeds WHERE sync_key = ?').bind(syncKey).first<{ n: number }>(),
      db.prepare('SELECT COUNT(*) AS n FROM flags WHERE sync_key = ?').bind(syncKey).first<{ n: number }>(),
    ]);
    const projectedFeeds = (feedCount?.n ?? 0) + feeds.length;
    const projectedFlags = (flagCount?.n ?? 0) + flags.length;
    if (projectedFeeds > 10_000 || projectedFlags > 1_000_000) {
      return new Response('Per-user row cap exceeded', { status: 413 });
    }

    // Validate payloads and build batch.
    const stmts: D1PreparedStatement[] = [];
    let maxAt = 0;

    for (const f of feeds) {
      if (typeof f.feedId !== 'string' || !f.feedId) {
        return jsonError('feed.feedId must be a non-empty string', 'feedId');
      }
      if (f.feedUrl !== undefined) {
        if (typeof f.feedUrl.at !== 'number' || f.feedUrl.at < 0) {
          return jsonError('feed.feedUrl.at must be a non-negative integer', 'feedUrl.at');
        }
        if (typeof f.feedUrl.value !== 'string') {
          return jsonError('feed.feedUrl.value must be a string', 'feedUrl.value');
        }
      }
      if (f.folder !== undefined) {
        const v = f.folder;
        if (typeof v.at !== 'number' || v.at < 0) {
          return jsonError('feed.folder.at must be a non-negative integer', 'folder.at');
        }
        if (v.value !== null && !Array.isArray(v.value)) {
          return jsonError('feed.folder.value must be an array or null', 'folder.value');
        }
      }
      if (f.title !== undefined) {
        if (typeof f.title.at !== 'number' || f.title.at < 0) {
          return jsonError('feed.title.at must be a non-negative integer', 'title.at');
        }
        if (typeof f.title.value !== 'string') {
          return jsonError('feed.title.value must be a string', 'title.value');
        }
      }
      if (f.tags !== undefined) {
        if (typeof f.tags.at !== 'number' || f.tags.at < 0) {
          return jsonError('feed.tags.at must be a non-negative integer', 'tags.at');
        }
        if (f.tags.value !== null && !Array.isArray(f.tags.value)) {
          return jsonError('feed.tags.value must be an array or null', 'tags.value');
        }
      }
      if (f.deleted !== undefined) {
        if (typeof f.deleted.at !== 'number' || f.deleted.at < 0) {
          return jsonError('feed.deleted.at must be a non-negative integer', 'deleted.at');
        }
        if (f.deleted.value !== 0 && f.deleted.value !== 1) {
          return jsonError('feed.deleted.value must be 0 or 1', 'deleted.value');
        }
      }

      // Step 1: insert new row.
      stmts.push(
        db
          .prepare('INSERT OR IGNORE INTO feeds (sync_key, feed_id, row_at) VALUES (?, ?, 0)')
          .bind(syncKey, f.feedId),
      );

      // Step 2: clear tombstone if present.
      stmts.push(
        db
          .prepare(
            'UPDATE feeds SET deleted = 0, deleted_at = NULL WHERE sync_key = ? AND feed_id = ? AND deleted = 1',
          )
          .bind(syncKey, f.feedId),
      );

      // Step 3: per-field PATCH.
      const fieldSets: string[] = [];
      const fieldBinds: unknown[] = [];
      if (f.feedUrl !== undefined) {
        fieldSets.push(
          "feed_url = CASE WHEN feed_url_at IS NULL OR ? > feed_url_at THEN ? ELSE feed_url END",
          "feed_url_at = CASE WHEN feed_url_at IS NULL OR ? > feed_url_at THEN ? ELSE feed_url_at END",
        );
        fieldBinds.push(f.feedUrl.at, f.feedUrl.value);
        fieldBinds.push(f.feedUrl.at, f.feedUrl.at);
        maxAt = Math.max(maxAt, f.feedUrl.at);
      }
      if (f.folder !== undefined) {
        fieldSets.push(
          "folder = CASE WHEN folder_at IS NULL OR ? > folder_at THEN ? ELSE folder END",
          "folder_at = CASE WHEN folder_at IS NULL OR ? > folder_at THEN ? ELSE folder_at END",
        );
        fieldBinds.push(f.folder.at, f.folder.value === null ? null : JSON.stringify(f.folder.value));
        fieldBinds.push(f.folder.at, f.folder.at);
        maxAt = Math.max(maxAt, f.folder.at);
      }
      if (f.title !== undefined) {
        fieldSets.push(
          "title = CASE WHEN title_at IS NULL OR ? > title_at THEN ? ELSE title END",
          "title_at = CASE WHEN title_at IS NULL OR ? > title_at THEN ? ELSE title_at END",
        );
        fieldBinds.push(f.title.at, f.title.value);
        fieldBinds.push(f.title.at, f.title.at);
        maxAt = Math.max(maxAt, f.title.at);
      }
      if (f.tags !== undefined) {
        fieldSets.push(
          "tags = CASE WHEN tags_at IS NULL OR ? > tags_at THEN ? ELSE tags END",
          "tags_at = CASE WHEN tags_at IS NULL OR ? > tags_at THEN ? ELSE tags_at END",
        );
        fieldBinds.push(f.tags.at, f.tags.value === null ? null : JSON.stringify(f.tags.value));
        fieldBinds.push(f.tags.at, f.tags.at);
        maxAt = Math.max(maxAt, f.tags.at);
      }
      if (f.deleted !== undefined) {
        fieldSets.push(
          "deleted = CASE WHEN deleted_at IS NULL OR ? > deleted_at THEN ? ELSE deleted END",
          "deleted_at = CASE WHEN deleted_at IS NULL OR ? > deleted_at THEN ? ELSE deleted_at END",
        );
        fieldBinds.push(f.deleted.at, f.deleted.value);
        fieldBinds.push(f.deleted.at, f.deleted.at);
        maxAt = Math.max(maxAt, f.deleted.at);
      }
      stmts.push(
        db
          .prepare(
            `UPDATE feeds SET ${fieldSets.join(', ')} WHERE sync_key = ? AND feed_id = ?`,
          )
          .bind(...fieldBinds, syncKey, f.feedId),
      );
      stmts.push(
        db
          .prepare('UPDATE feeds SET row_at = ? WHERE sync_key = ? AND feed_id = ? AND ? > COALESCE(row_at, 0)')
          .bind(maxAt, syncKey, f.feedId, maxAt),
      );
      assertNoUrlLog(f.feedUrl?.value ?? '');
    }

    for (const g of flags) {
      if (typeof g.itemId !== 'string' || !g.itemId) {
        return jsonError('flag.itemId must be a non-empty string', 'itemId');
      }
      const derived = deriveFeedIdFromItemId(g.itemId);
      if (!derived) {
        return jsonError('flag.itemId must contain "::"', 'itemId');
      }
      if (typeof g.feedId !== 'string' || g.feedId !== derived) {
        return jsonError('flag.feedId does not match itemId', 'feedId');
      }
      if (typeof g.read?.value !== 'number' || (g.read.value !== 0 && g.read.value !== 1)) {
        return jsonError('flag.read.value must be 0 or 1', 'read.value');
      }
      if (typeof g.read?.at !== 'number' || g.read.at < 0) {
        return jsonError('flag.read.at must be a non-negative integer', 'read.at');
      }
      if (typeof g.starred?.value !== 'number' || (g.starred.value !== 0 && g.starred.value !== 1)) {
        return jsonError('flag.starred.value must be 0 or 1', 'starred.value');
      }
      if (typeof g.starred?.at !== 'number' || g.starred.at < 0) {
        return jsonError('flag.starred.at must be a non-negative integer', 'starred.at');
      }

      const flagMaxAt = Math.max(g.read.at, g.starred.at);
      maxAt = Math.max(maxAt, flagMaxAt);
      stmts.push(
        db
          .prepare('INSERT OR REPLACE INTO flags (sync_key, item_id, feed_id, read, read_at, starred, starred_at, row_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
          .bind(syncKey, g.itemId, derived, g.read.value, g.read.at, g.starred.value, g.starred.at, flagMaxAt),
      );
      assertNoUrlLog(g.feedId);
    }

    // Assign a server monotonic timestamp for this batch (used as row_at for new rows).
    if (stmts.length > 0) {
      const batchT = await nextMonotonicTime(db);
      maxAt = Math.max(maxAt, batchT);
      // No-op consume of the timestamp so the counter still advances even on pure-overwrite pushes.
      void maxAt;
    }

    await db.batch(stmts);
    return c.body(null, 204);
  });

  // GET /sync/pull?since=<ms>
  app.get('/sync/pull', async (c) => {
    const { syncKey } = getSyncKeyContext(c);

    const rl = await checkRateLimit(
      db,
      `pull:${syncKey}`,
      RATE_LIMITS.pull.windowSeconds,
      RATE_LIMITS.pull.limit,
      now(),
    );
    if (!rl.ok) {
      return rateLimitResponse(`pull:${syncKey}`, syncKey, rl.retryAfter, 429);
    }

    const sinceRaw = c.req.query('since');
    let since = 0;
    if (sinceRaw !== undefined && sinceRaw !== '' && sinceRaw !== 'null') {
      const n = Number(sinceRaw);
      if (!Number.isFinite(n) || n < 0) {
        return jsonError('Invalid `since` query parameter', 'since');
      }
      since = Math.floor(n);
    }

    const [feedsRes, flagsRes, serverTime] = await Promise.all([
      db
        .prepare('SELECT * FROM feeds WHERE sync_key = ? AND row_at > ? ORDER BY row_at ASC')
        .bind(syncKey, since)
        .all(),
      db
        .prepare('SELECT * FROM flags WHERE sync_key = ? AND row_at > ? ORDER BY row_at ASC')
        .bind(syncKey, since)
        .all(),
      currentMonotonicTime(db),
    ]);

    return c.json({ serverTime, feeds: feedsRes.results, flags: flagsRes.results });
  });

  return app;
}
