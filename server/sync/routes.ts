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
import {
  requirePrincipal,
  requireMaster,
  requirePullPrincipal,
  getSyncKeyContext,
  isValidSyncKey,
  generatePairingCode,
  isPairingCode,
  clientIp,
  type SyncKeyEnv,
} from './auth';
import { RATE_LIMITS, checkRateLimit } from './ratelimit';
import { nextMonotonicTime, currentMonotonicTime } from './monotonic';
import { ensureSchema } from './schema';
import { assertNoKeyLog, assertNoUserDataLog, assertNoUrlLog } from '../log';
import { decodeItemId } from '../../src/sync/itemId';
import { generateToken, generateTokenId, sha256Hex, tokenFingerprint, syncKeyFingerprint } from './tokens';

const PAIRING_TTL_SECONDS = 5 * 60;
const MAX_USERS = 100_000;

interface FeedPayload {
  feedId: string;
  feedUrl?: string;
  htmlUrl?: string | null;
  folder?: string[] | null;
  title?: string;
  tags?: string[] | null;
  deleted?: 0 | 1;
}

interface FlagPayload {
  itemId: string;
  feedId: string;
  read?: 0 | 1 | null;
  starred?: 0 | 1 | null;
}

interface PushBody {
  feeds?: FeedPayload[];
  flags?: FlagPayload[];
}

/** True when a value is a legacy `{ value, at }` wrapper. */
function isLegacyWrapper(v: unknown): v is { value: unknown; at: unknown } {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function validateFeedPayload(f: FeedPayload): { message: string; field: string } | null {
  if (typeof f.feedId !== 'string' || !f.feedId) {
    return { message: 'feed.feedId must be a non-empty string', field: 'feedId' };
  }
  if (f.feedUrl !== undefined) {
    if (isLegacyWrapper(f.feedUrl)) {
      return { message: 'feed.feedUrl must not contain timestamps (server stamps all writes)', field: 'feedUrl' };
    }
    if (typeof f.feedUrl !== 'string') {
      return { message: 'feed.feedUrl must be a string', field: 'feedUrl' };
    }
  }
  if (f.htmlUrl !== undefined) {
    if (isLegacyWrapper(f.htmlUrl)) {
      return { message: 'feed.htmlUrl must not contain timestamps (server stamps all writes)', field: 'htmlUrl' };
    }
    if (f.htmlUrl !== null && typeof f.htmlUrl !== 'string') {
      return { message: 'feed.htmlUrl must be a string or null', field: 'htmlUrl' };
    }
  }
  if (f.folder !== undefined) {
    if (isLegacyWrapper(f.folder)) {
      return { message: 'feed.folder must not contain timestamps (server stamps all writes)', field: 'folder' };
    }
    if (f.folder !== null && !Array.isArray(f.folder)) {
      return { message: 'feed.folder must be an array or null', field: 'folder' };
    }
  }
  if (f.title !== undefined) {
    if (isLegacyWrapper(f.title)) {
      return { message: 'feed.title must not contain timestamps (server stamps all writes)', field: 'title' };
    }
    if (typeof f.title !== 'string') {
      return { message: 'feed.title must be a string', field: 'title' };
    }
  }
  if (f.tags !== undefined) {
    if (isLegacyWrapper(f.tags)) {
      return { message: 'feed.tags must not contain timestamps (server stamps all writes)', field: 'tags' };
    }
    if (f.tags !== null && !Array.isArray(f.tags)) {
      return { message: 'feed.tags must be an array or null', field: 'tags' };
    }
  }
  if (f.deleted !== undefined) {
    if (isLegacyWrapper(f.deleted)) {
      return { message: 'feed.deleted must not contain timestamps (server stamps all writes)', field: 'deleted' };
    }
    if (f.deleted !== 0 && f.deleted !== 1) {
      return { message: 'feed.deleted must be 0 or 1', field: 'deleted' };
    }
  }
  return null;
}

function validateFlagPayload(g: FlagPayload): { message: string; field: string } | null {
  if (typeof g.itemId !== 'string' || !g.itemId) {
    return { message: 'flag.itemId must be a non-empty string', field: 'itemId' };
  }
  const parsed = decodeItemId(g.itemId);
  if (!parsed) {
    return { message: 'flag.itemId must contain "::"', field: 'itemId' };
  }
  if (typeof g.feedId !== 'string' || g.feedId !== parsed.feedId) {
    return { message: 'flag.feedId does not match itemId', field: 'feedId' };
  }
  if (g.read !== undefined) {
    if (isLegacyWrapper(g.read)) {
      return { message: 'flag.read must not contain timestamps (server stamps all writes)', field: 'read' };
    }
    if (g.read !== null && g.read !== 0 && g.read !== 1) {
      return { message: 'flag.read must be 0, 1, or null', field: 'read' };
    }
  }
  if (g.starred !== undefined) {
    if (isLegacyWrapper(g.starred)) {
      return { message: 'flag.starred must not contain timestamps (server stamps all writes)', field: 'starred' };
    }
    if (g.starred !== null && g.starred !== 0 && g.starred !== 1) {
      return { message: 'flag.starred must be 0, 1, or null', field: 'starred' };
    }
  }
  return null;
}

function rateLimitResponse(scope: string, limitKey: string, retryAfter: number, status: 429 | 503 = 429): Response {
  return new Response(null, {
    status,
    headers: { 'Retry-After': String(retryAfter), 'Cache-Control': 'no-store' },
  });
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

    // Check 4: a rotated (regenerated-away) key must never be resurrected.
    // Otherwise a stolen old key could be re-registered into a working group.
    const existing = await db
      .prepare('SELECT rotated_at FROM users WHERE sync_key = ?')
      .bind(syncKey)
      .first<{ rotated_at: number | null }>();
    if (existing && existing.rotated_at !== null) {
      return c.text('Forbidden', 403);
    }

    // Lazy create (idempotent).
    await db
      .prepare('INSERT OR IGNORE INTO users (sync_key, created_at) VALUES (?, ?)')
      .bind(syncKey, now())
      .run();

    return c.body(null, 204);
  });

  // Authenticated data routes.
  // Master-key-only routes: /sync/otp (a device code redeems to the master
  // key), /sync/tokens (token lifecycle), /sync/rotate. Agent tokens:
  // pull/push only. Pull additionally accepts an agent pairing code
  // (?code=) — read-only.
  const auth = requirePrincipal(db);
  const masterAuth = requireMaster(db);
  const pullAuth = requirePullPrincipal(db);
  app.use('/sync/otp', masterAuth);
  app.use('/sync/push', auth);
  app.use('/sync/pull', pullAuth);
  app.use('/sync/status', auth);
  app.use('/sync/tokens', masterAuth);
  app.use('/sync/rotate', masterAuth);

  // POST /sync/rotate — regenerate the sync key (master key only).
  // Body: { sync_key: <new key> }. The header carries the OLD key. The old
  // key's users row is marked rotated: master-key auth and agent-token auth
  // reject it (401) and /sync/register refuses to resurrect it (403) — a
  // rotated key is dead, devices must re-pair with the new key, and every
  // agent token minted under it is orphaned. The new key is registered so
  // the regenerating browser keeps its group (its dirty state then pushes
  // into the new row as usual).
  app.post('/sync/rotate', async (c) => {
    const { syncKey: oldKey } = getSyncKeyContext(c);

    const rl = await checkRateLimit(
      db,
      `rotate:${oldKey}`,
      RATE_LIMITS.rotate.windowSeconds,
      RATE_LIMITS.rotate.limit,
      now(),
    );
    if (!rl.ok) {
      return rateLimitResponse(`rotate:${oldKey}`, oldKey, rl.retryAfter, 429);
    }

    let body: { sync_key?: unknown };
    try {
      body = await c.req.json();
    } catch {
      return jsonError('Invalid JSON body', 'body');
    }
    const newKey = typeof body.sync_key === 'string' ? body.sync_key : '';
    if (!isValidSyncKey(newKey)) {
      return jsonError('sync_key must be a 22-character base64url key', 'sync_key');
    }
    if (newKey === oldKey) {
      return jsonError('sync_key must differ from the current key', 'sync_key');
    }

    await db.batch([
      db.prepare('INSERT OR IGNORE INTO users (sync_key, created_at) VALUES (?, ?)').bind(newKey, now()),
      db.prepare('UPDATE users SET rotated_at = ? WHERE sync_key = ?').bind(now(), oldKey),
    ]);
    assertNoKeyLog(oldKey);
    return c.body(null, 204);
  });

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
      .prepare('SELECT sync_key, expires_at FROM pairing_codes WHERE code = ? AND kind = ?')
      .bind(code, 'device')
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

  // POST /sync/tokens — mint an agent pairing code (master key only).
  // The code is redeemed by `siftctl pair` / an OAS consumer; the token
  // never passes through the browser.
  app.post('/sync/tokens', async (c) => {
    const { syncKey } = getSyncKeyContext(c);

    const rl = await checkRateLimit(
      db,
      `tokens:mint:${syncKey}`,
      RATE_LIMITS.tokensMint.windowSeconds,
      RATE_LIMITS.tokensMint.limit,
      now(),
    );
    if (!rl.ok) {
      return rateLimitResponse(`tokens:mint:${syncKey}`, syncKey, rl.retryAfter, 429);
    }

    const expiresAt = now() + PAIRING_TTL_SECONDS;
    let code = '';
    for (let attempt = 0; attempt < 5; attempt++) {
      const candidate = generatePairingCode();
      try {
        await db
          .prepare('INSERT INTO pairing_codes (code, sync_key, expires_at, kind) VALUES (?, ?, ?, ?)')
          .bind(candidate, syncKey, expiresAt, 'agent')
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

  // POST /sync/tokens/redeem — exchange an agent pairing code for a token.
  // Public (like device redeem); rate-limited per IP on its own scope.
  app.post('/sync/tokens/redeem', async (c) => {
    const ip = clientIp(c);
    const rl = await checkRateLimit(
      db,
      `tokens:redeem:${ip}`,
      RATE_LIMITS.tokensRedeem.windowSeconds,
      RATE_LIMITS.tokensRedeem.limit,
      now(),
    );
    if (!rl.ok) {
      return rateLimitResponse(`tokens:redeem:${ip}`, ip, rl.retryAfter, 429);
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
      .prepare('SELECT sync_key, expires_at FROM pairing_codes WHERE code = ? AND kind = ?')
      .bind(code, 'agent')
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

    const token = generateToken();
    const tokenId = generateTokenId();
    const [tokenHash, fingerprint] = await Promise.all([
      sha256Hex(token),
      tokenFingerprint(token),
    ]);
    await db
      .prepare(
        'INSERT INTO tokens (token_id, token_hash, sync_key, scope, fingerprint, created_at) VALUES (?, ?, ?, ?, ?, ?)',
      )
      .bind(tokenId, tokenHash, row.sync_key, 'rw', fingerprint, now())
      .run();
    assertNoKeyLog(row.sync_key);
    return c.json({ token });
  });

  // GET /sync/tokens — list token metadata (master key only, never raw tokens).
  app.get('/sync/tokens', async (c) => {
    const { syncKey } = getSyncKeyContext(c);

    const res = await db
      .prepare('SELECT token_id, fingerprint, scope, created_at, last_seen_at FROM tokens WHERE sync_key = ? ORDER BY created_at ASC')
      .bind(syncKey)
      .all();
    return c.json({ tokens: res.results });
  });

  // DELETE /sync/tokens — revoke a token by id (master key only).
  app.delete('/sync/tokens', async (c) => {
    const { syncKey } = getSyncKeyContext(c);

    let body: { token_id?: unknown };
    try {
      body = await c.req.json();
    } catch {
      return jsonError('Invalid JSON body', 'body');
    }
    const tokenId = typeof body.token_id === 'string' && body.token_id ? body.token_id : '';
    if (!tokenId) {
      return jsonError('token_id is required', 'token_id');
    }
    await db
      .prepare('DELETE FROM tokens WHERE token_id = ? AND sync_key = ?')
      .bind(tokenId, syncKey)
      .run();
    return c.body(null, 204);
  });

  // GET /sync/status — authenticated; returns the group fingerprint so
  // `siftctl status` can show the same short code as Settings. Works with
  // master keys and agent tokens (mounted with `auth` above).
  app.get('/sync/status', async (c) => {
    const { syncKey } = getSyncKeyContext(c);
    return c.json({ groupFingerprint: await syncKeyFingerprint(syncKey) });
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

    // Validate payloads up front (all-or-nothing before any reads or writes).
    for (const f of feeds) {
      const err = validateFeedPayload(f);
      if (err) return jsonError(err.message, err.field);
    }
    for (const g of flags) {
      const err = validateFlagPayload(g);
      if (err) return jsonError(err.message, err.field);
    }

    // D5/D6 pre-pass: resolve the URL for each deleted feed — payload URL
    // wins over the stored row's URL (a server-stamped payload is always
    // newer), with the DB as fallback for legacy URL-less deletes. The
    // results build both the sibling-tombstone set (D5) and the in-batch
    // tombstone map (D6).
    const deleteIds = feeds.filter((f) => f.deleted === 1).map((f) => f.feedId);
    const rowUrlInfo = new Map<string, { url: string | null }>();
    if (deleteIds.length > 0) {
      const placeholders = deleteIds.map(() => '?').join(', ');
      const res = await db
        .prepare(`SELECT feed_id, feed_url FROM feeds WHERE sync_key = ? AND feed_id IN (${placeholders})`)
        .bind(syncKey, ...deleteIds)
        .all();
      for (const r of res.results as Array<{ feed_id: string; feed_url: string | null }>) {
        rowUrlInfo.set(r.feed_id, { url: r.feed_url ?? null });
      }
    }
    const siblingUrlByDelete = new Map<string, string>();
    for (const f of feeds) {
      if (f.deleted !== 1) continue;
      const url = f.feedUrl ?? rowUrlInfo.get(f.feedId)?.url ?? null;
      if (url) siblingUrlByDelete.set(f.feedId, url);
    }
    const inBatchTombstones = new Map<string, string>();
    for (const f of feeds) {
      if (f.deleted !== 1) continue;
      const url = siblingUrlByDelete.get(f.feedId);
      if (url && !inBatchTombstones.has(url)) inBatchTombstones.set(url, f.feedId);
    }

    // D6 routing: a subscribe (deleted: 0 + feedUrl) revives the oldest
    // tombstoned row for the URL under its existing feed_id — the in-batch
    // map first (a tombstone created earlier in this batch is invisible to
    // the DB), then the DB's oldest tombstone.
    const effectiveFeedId = new Map<number, string>();
    let d6Routed = 0;
    for (let i = 0; i < feeds.length; i++) {
      const f = feeds[i];
      if (f.deleted !== 0 || f.feedUrl === undefined) continue;
      const revived = inBatchTombstones.get(f.feedUrl)
        ?? (await db
          .prepare('SELECT feed_id FROM feeds WHERE sync_key = ? AND feed_url = ? AND deleted = 1 ORDER BY row_at ASC LIMIT 1')
          .bind(syncKey, f.feedUrl)
          .first<{ feed_id: string }>())?.feed_id;
      if (revived && revived !== f.feedId) {
        effectiveFeedId.set(i, revived);
        d6Routed++;
      }
    }

    // Per-user row cap check (D6-routed subscribes insert no rows; tombstones are transient).
    const [feedCount, flagCount] = await Promise.all([
      db.prepare('SELECT COUNT(*) AS n FROM feeds WHERE sync_key = ? AND deleted = 0').bind(syncKey).first<{ n: number }>(),
      db.prepare('SELECT COUNT(*) AS n FROM flags WHERE sync_key = ?').bind(syncKey).first<{ n: number }>(),
    ]);
    const projectedFeeds = (feedCount?.n ?? 0) + feeds.length - d6Routed;
    const projectedFlags = (flagCount?.n ?? 0) + flags.length;
    if (projectedFeeds > 10_000 || projectedFlags > 1_000_000) {
      return new Response('Per-user row cap exceeded', { status: 413 });
    }

    // Assign the server monotonic batch time BEFORE building statements:
    // every row touched by this batch shares one row_at (delivery once per
    // batch, arrival-ordered).
    const batchT = await nextMonotonicTime(db);

    // Build batch.
    const stmts: D1PreparedStatement[] = [];

    for (let i = 0; i < feeds.length; i++) {
      const f = feeds[i];
      const fId = effectiveFeedId.get(i) ?? f.feedId;

      // Step 1: insert new row (a no-op for existing rows, including D6-revived ids).
      stmts.push(
        db
          .prepare('INSERT OR IGNORE INTO feeds (sync_key, feed_id, row_at) VALUES (?, ?, 0)')
          .bind(syncKey, fId),
      );

      // Step 2: clear tombstone — only on an explicit subscribe signal
      // (deleted: 0). A deleted: 1 push never clears (the PATCH below is
      // LWW-correct and must not regress a newer tombstone's deleted_at).
      if (f.deleted !== undefined && f.deleted === 0) {
        stmts.push(
          db
            .prepare(
              'UPDATE feeds SET deleted = 0, deleted_at = NULL WHERE sync_key = ? AND feed_id = ? AND deleted = 1',
            )
            .bind(syncKey, fId),
        );
      }

      // Step 3: per-field PATCH. Every field is stamped by the server with
      // the batch time (no client timestamps exist in the protocol). The
      // deleted field compares with >= so a tombstone wins equal stamps
      // (an in-batch subscribe then delete leaves no live row).
      const fieldSets: string[] = [];
      const fieldBinds: unknown[] = [];
      if (f.feedUrl !== undefined) {
        fieldSets.push(
          "feed_url = CASE WHEN feed_url_at IS NULL OR ? > feed_url_at THEN ? ELSE feed_url END",
          "feed_url_at = CASE WHEN feed_url_at IS NULL OR ? > feed_url_at THEN ? ELSE feed_url_at END",
        );
        fieldBinds.push(batchT, f.feedUrl);
        fieldBinds.push(batchT, batchT);
      }
      if (f.folder !== undefined) {
        fieldSets.push(
          "folder = CASE WHEN folder_at IS NULL OR ? > folder_at THEN ? ELSE folder END",
          "folder_at = CASE WHEN folder_at IS NULL OR ? > folder_at THEN ? ELSE folder_at END",
        );
        fieldBinds.push(batchT, f.folder === null ? null : JSON.stringify(f.folder));
        fieldBinds.push(batchT, batchT);
      }
      if (f.title !== undefined) {
        fieldSets.push(
          "title = CASE WHEN title_at IS NULL OR ? > title_at THEN ? ELSE title END",
          "title_at = CASE WHEN title_at IS NULL OR ? > title_at THEN ? ELSE title_at END",
        );
        fieldBinds.push(batchT, f.title);
        fieldBinds.push(batchT, batchT);
      }
      if (f.htmlUrl !== undefined) {
        fieldSets.push(
          "html_url = CASE WHEN html_url_at IS NULL OR ? > html_url_at THEN ? ELSE html_url END",
          "html_url_at = CASE WHEN html_url_at IS NULL OR ? > html_url_at THEN ? ELSE html_url_at END",
        );
        fieldBinds.push(batchT, f.htmlUrl);
        fieldBinds.push(batchT, batchT);
      }
      if (f.tags !== undefined) {
        fieldSets.push(
          "tags = CASE WHEN tags_at IS NULL OR ? > tags_at THEN ? ELSE tags END",
          "tags_at = CASE WHEN tags_at IS NULL OR ? > tags_at THEN ? ELSE tags_at END",
        );
        fieldBinds.push(batchT, f.tags === null ? null : JSON.stringify(f.tags));
        fieldBinds.push(batchT, batchT);
      }
      if (f.deleted !== undefined) {
        fieldSets.push(
          "deleted = CASE WHEN deleted_at IS NULL OR ? >= deleted_at THEN ? ELSE deleted END",
          "deleted_at = CASE WHEN deleted_at IS NULL OR ? >= deleted_at THEN ? ELSE deleted_at END",
        );
        fieldBinds.push(batchT, f.deleted);
        fieldBinds.push(batchT, batchT);
      }
      stmts.push(
        db
          .prepare(
            `UPDATE feeds SET ${fieldSets.join(', ')} WHERE sync_key = ? AND feed_id = ?`,
          )
          .bind(...fieldBinds, syncKey, fId),
      );
      stmts.push(
        db
          .prepare('UPDATE feeds SET row_at = ? WHERE sync_key = ? AND feed_id = ? AND ? > COALESCE(row_at, 0)')
          .bind(batchT, syncKey, fId, batchT),
      );
      assertNoUrlLog(f.feedUrl ?? '');
      assertNoUrlLog(f.htmlUrl ?? '');
    }

    // D5: tombstone every row sharing a deleted feed's URL. One UPDATE per
    // unique URL. The deleted comparison uses >= so an in-batch subscribe
    // that created a row under the URL is also tombstoned (ties win for
    // tombstones). Column order deleted, deleted_at, row_at is load-bearing:
    // the dev D1 shim pairs CASE fields positionally.
    for (const url of siblingUrlByDelete.values()) {
      assertNoUrlLog(url);
      stmts.push(
        db
          .prepare(
            'UPDATE feeds SET deleted = CASE WHEN deleted_at IS NULL OR ? >= deleted_at THEN ? ELSE deleted END, deleted_at = CASE WHEN deleted_at IS NULL OR ? >= deleted_at THEN ? ELSE deleted_at END, row_at = CASE WHEN ? > row_at THEN ? ELSE row_at END WHERE sync_key = ? AND feed_url = ? AND feed_id != ?',
          )
          .bind(batchT, 1, batchT, batchT, batchT, batchT, syncKey, url, inBatchTombstones.get(url) ?? ''),
      );
    }

    for (const g of flags) {
      stmts.push(
        db
          .prepare('INSERT OR IGNORE INTO flags (sync_key, item_id, feed_id, row_at) VALUES (?, ?, ?, 0)')
          .bind(syncKey, g.itemId, g.feedId),
      );

      const fieldSets: string[] = [];
      const fieldBinds: unknown[] = [];
      if (g.read !== undefined) {
        fieldSets.push(
          "read = CASE WHEN read_at IS NULL OR ? > read_at THEN ? ELSE read END",
          "read_at = CASE WHEN read_at IS NULL OR ? > read_at THEN ? ELSE read_at END",
        );
        fieldBinds.push(batchT, g.read);
        fieldBinds.push(batchT, batchT);
      }
      if (g.starred !== undefined) {
        fieldSets.push(
          "starred = CASE WHEN starred_at IS NULL OR ? > starred_at THEN ? ELSE starred END",
          "starred_at = CASE WHEN starred_at IS NULL OR ? > starred_at THEN ? ELSE starred_at END",
        );
        fieldBinds.push(batchT, g.starred);
        fieldBinds.push(batchT, batchT);
      }
      stmts.push(
        db
          .prepare(`UPDATE flags SET ${fieldSets.join(', ')} WHERE sync_key = ? AND item_id = ?`)
          .bind(...fieldBinds, syncKey, g.itemId),
      );
      stmts.push(
        db
          .prepare('UPDATE flags SET row_at = ? WHERE sync_key = ? AND item_id = ? AND ? > COALESCE(row_at, 0)')
          .bind(batchT, syncKey, g.itemId, batchT),
      );
      assertNoUrlLog(g.feedId);
    }

    await db.batch(stmts);
    return c.body(null, 204);
  });

  // GET /sync/pull?since=<ms>&code=<agent code>
  // The `code` query parameter authenticates read-only (agent pairing code);
  // responses are never cached — pull data is personal and a code rides in
  // the URL, so shared caches must not replay one user's state to another.
  app.get('/sync/pull', async (c) => {
    c.header('Cache-Control', 'no-store');
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
        .prepare('SELECT * FROM feeds WHERE sync_key = ? AND row_at >= ? ORDER BY row_at ASC')
        .bind(syncKey, since)
        .all(),
      db
        .prepare('SELECT * FROM flags WHERE sync_key = ? AND row_at >= ? ORDER BY row_at ASC')
        .bind(syncKey, since)
        .all(),
      currentMonotonicTime(db),
    ]);

    return c.json({ serverTime, feeds: feedsRes.results, flags: flagsRes.results });
  });

  return app;
}
