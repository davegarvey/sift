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
  requireScope,
  rateLimitKey,
  getSyncKeyContext,
  isValidSyncKey,
  generatePairingCode,
  isPairingCode,
  clientIp,
  type SyncKeyEnv,
} from './auth';
import { RATE_LIMITS, checkRateLimit } from './ratelimit';
import { nextMonotonicTime, currentMonotonicTime } from './monotonic';
import { applyPush, isLegacyWrapper, type PushBody } from './apply-push';
import { ensureSchema } from './schema';
import { assertNoKeyLog, assertNoUserDataLog, assertNoUrlLog } from '../log';
import { decodeItemId } from '../../src/sync/itemId';
import { generateToken, generateTokenId, sha256Hex, tokenFingerprint, syncKeyFingerprint } from './tokens';
import { MAX_POLLED_FEEDS_PER_ACCOUNT, registerPolledFeeds, removeUnsubscribedPolledFeeds } from '../poll-registry';
import { accountFeedUrls, deleteAccount } from './account';

const TOKEN_LABEL_MAX = 64;
const PAIRING_TTL_SECONDS = 5 * 60;
const MAX_USERS = 100_000;
const ITEMS_PAGE_SIZE = 200;
const ACTIVITY_WRITE_INTERVAL_SECONDS = 60 * 60;

interface StatsPayload {
  feedId: string;
  totalSeen: number;
  feedUrl?: string | null;
  title?: string | null;
}

interface MarkerPayload {
  itemId: string;
  feedId: string;
}

interface StatsPushBody {
  stats?: StatsPayload[];
  markers?: MarkerPayload[];
}

const MAX_STATS_PER_PUSH = 500;
const MAX_TOTAL_SEEN = 2_000_000_000;

function validateStatsPayload(s: StatsPayload): { message: string; field: string } | null {
  if (typeof s.feedId !== 'string' || !s.feedId) {
    return { message: 'stats.feedId must be a non-empty string', field: 'feedId' };
  }
  if (!Number.isSafeInteger(s.totalSeen) || s.totalSeen < 0 || s.totalSeen > MAX_TOTAL_SEEN) {
    return { message: 'stats.totalSeen must be a safe non-negative integer within bounds', field: 'totalSeen' };
  }
  if (s.feedUrl !== undefined && isLegacyWrapper(s.feedUrl)) {
    return { message: 'stats.feedUrl must not contain timestamps (server stamps all writes)', field: 'feedUrl' };
  }
  if (s.feedUrl !== undefined && s.feedUrl !== null && typeof s.feedUrl !== 'string') {
    return { message: 'stats.feedUrl must be a string or null', field: 'feedUrl' };
  }
  if (s.title !== undefined && isLegacyWrapper(s.title)) {
    return { message: 'stats.title must not contain timestamps (server stamps all writes)', field: 'title' };
  }
  if (s.title !== undefined && s.title !== null && typeof s.title !== 'string') {
    return { message: 'stats.title must be a string or null', field: 'title' };
  }
  return null;
}

function validateMarkerPayload(m: MarkerPayload): { message: string; field: string } | null {
  if (typeof m.itemId !== 'string' || !m.itemId) {
    return { message: 'marker.itemId must be a non-empty string', field: 'itemId' };
  }
  const parsed = decodeItemId(m.itemId);
  if (!parsed) {
    return { message: 'marker.itemId must contain "::"', field: 'itemId' };
  }
  if (typeof m.feedId !== 'string' || m.feedId !== parsed.feedId) {
    return { message: 'marker.feedId does not match itemId', field: 'feedId' };
  }
  return null;
}

function parseLabel(raw: unknown): { ok: true; label: string | null } | { ok: false } {
  if (raw === undefined || raw === null) return { ok: true, label: null };
  if (typeof raw !== 'string') return { ok: false };
  const label = raw.trim();
  if (label.length > TOKEN_LABEL_MAX) return { ok: false };
  return { ok: true, label: label === '' ? null : label };
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
  /** Poll database; server-side feed polling and /sync/items are enabled only when present. */
  pollDb?: D1Database;
}

function parseCursor(raw: string | undefined): number | null {
  if (raw === undefined || raw === '' || raw === 'null') return 0;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.floor(n);
}

export function createSyncRoutes(db: D1Database, opts: SyncRoutesOptions = {}): Hono<SyncKeyEnv> {
  const app = new Hono<SyncKeyEnv>();
  const now = opts.nowSeconds ?? (() => Math.floor(Date.now() / 1000));
  const pollDb = opts.pollDb;

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
  app.get('/sync/capabilities', (c) => c.json({ sync: true, stats: true, items: pollDb !== undefined }));

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
  // `read` scope for pull, stats pull and items, `write` additionally for push.
  const auth = requirePrincipal(db);
  const masterAuth = requireMaster(db);
  const readScope = requireScope('read');
  const writeScope = requireScope('write');
  app.use('/sync/otp', masterAuth);
  app.use('/sync/push', auth, writeScope);
  app.use('/sync/pull', auth, readScope);
  app.use('/sync/stats/push', masterAuth);
  app.use('/sync/stats/pull', auth, readScope);
  if (pollDb) app.use('/sync/items', auth, readScope);
  app.use('/sync/status', auth);
  app.use('/sync/tokens', masterAuth);
  app.use('/sync/rotate', masterAuth);
  app.use('/sync/account', masterAuth);

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

  // DELETE /sync/account — delete the account and every row keyed by its
  // sync key (master key only). The batch is atomic. Polling state that no
  // other account subscribes to is removed afterwards; if that fails, the
  // daily poll maintenance removes it.
  app.delete('/sync/account', async (c) => {
    const { syncKey } = getSyncKeyContext(c);

    const rl = await checkRateLimit(
      db,
      `account-delete:${syncKey}`,
      RATE_LIMITS.accountDelete.windowSeconds,
      RATE_LIMITS.accountDelete.limit,
      now(),
    );
    if (!rl.ok) {
      return rateLimitResponse(`account-delete:${syncKey}`, syncKey, rl.retryAfter, 429);
    }

    const feedUrls = pollDb ? await accountFeedUrls(db, syncKey) : [];
    await deleteAccount(db, syncKey, { rateLimits: true });
    assertNoKeyLog(syncKey);

    if (pollDb && feedUrls.length > 0) {
      try {
        await removeUnsubscribedPolledFeeds(db, pollDb, feedUrls);
      } catch {
        // The daily poll maintenance removes the URLs instead.
      }
    }
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

    let body: { code?: unknown; label?: unknown };
    try {
      body = await c.req.json();
    } catch {
      return jsonError('Invalid JSON body', 'body');
    }
    const code = typeof body.code === 'string' ? body.code : '';
    if (!isPairingCode(code)) {
      return jsonError('Invalid pairing code', 'code');
    }
    const parsedLabel = parseLabel(body.label);
    if (!parsedLabel.ok) {
      return jsonError('label must be a string of at most 64 characters', 'label');
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
        'INSERT INTO tokens (token_id, token_hash, sync_key, scope, fingerprint, created_at, label) VALUES (?, ?, ?, ?, ?, ?, ?)',
      )
      .bind(tokenId, tokenHash, row.sync_key, 'rw', fingerprint, now(), parsedLabel.label)
      .run();
    assertNoKeyLog(row.sync_key);
    return c.json({ token });
  });

  // GET /sync/tokens — list token metadata (master key only, never raw tokens).
  app.get('/sync/tokens', async (c) => {
    const { syncKey } = getSyncKeyContext(c);

    const res = await db
      .prepare('SELECT token_id, fingerprint, scope, origin, label, client_name, scopes, created_at, last_seen_at FROM tokens WHERE sync_key = ? ORDER BY created_at ASC')
      .bind(syncKey)
      .all();
    // created_at is stored in epoch seconds (now()); the API reports
    // epoch milliseconds, matching last_seen_at and the OTP expiresAt.
    const tokens = (res.results as Array<{ created_at: number }>).map((r) => ({
      ...r,
      created_at: r.created_at * 1000,
    }));
    return c.json({ tokens });
  });

  // PATCH /sync/tokens — rename a grant (master key only). An empty label clears it.
  app.patch('/sync/tokens', async (c) => {
    const { syncKey } = getSyncKeyContext(c);

    let body: { tokenId?: unknown; label?: unknown };
    try {
      body = await c.req.json();
    } catch {
      return jsonError('Invalid JSON body', 'body');
    }
    const tokenId = typeof body.tokenId === 'string' && body.tokenId ? body.tokenId : '';
    if (!tokenId) {
      return jsonError('tokenId is required', 'tokenId');
    }
    if (typeof body.label !== 'string') {
      return jsonError('label must be a string', 'label');
    }
    const parsedLabel = parseLabel(body.label);
    if (!parsedLabel.ok) {
      return jsonError('label must be a string of at most 64 characters', 'label');
    }
    const existing = await db
      .prepare('SELECT token_id FROM tokens WHERE token_id = ? AND sync_key = ?')
      .bind(tokenId, syncKey)
      .first();
    if (!existing) return c.text('Not Found', 404);
    await db
      .prepare('UPDATE tokens SET label = ? WHERE token_id = ? AND sync_key = ?')
      .bind(parsedLabel.label, tokenId, syncKey)
      .run();
    return c.body(null, 204);
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
    const ctx = getSyncKeyContext(c);
    const { syncKey } = ctx;
    const bucket = rateLimitKey(ctx, 'push');

    const rl = await checkRateLimit(
      db,
      bucket,
      RATE_LIMITS.push.windowSeconds,
      RATE_LIMITS.push.limit,
      now(),
    );
    if (!rl.ok) {
      return rateLimitResponse(bucket, syncKey, rl.retryAfter, 429);
    }

    let body: PushBody;
    try {
      body = (await c.req.json()) as PushBody;
    } catch {
      return jsonError('Invalid JSON body', 'body');
    }
    const result = await applyPush(db, pollDb, syncKey, body);
    if (!result.ok) {
      if (result.kind === 'cap') return new Response('Per-user row cap exceeded', { status: 413 });
      return jsonError(result.message, result.field);
    }
    return c.body(null, 204);
  });


  // GET /sync/pull?since=<ms>
  // Responses are never cached — pull data is personal, so shared caches
  // must not replay one user's state to another.
  app.get('/sync/pull', async (c) => {
    c.header('Cache-Control', 'no-store');
    const ctx = getSyncKeyContext(c);
    const { syncKey } = ctx;
    const bucket = rateLimitKey(ctx, 'pull');

    const rl = await checkRateLimit(
      db,
      bucket,
      RATE_LIMITS.pull.windowSeconds,
      RATE_LIMITS.pull.limit,
      now(),
    );
    if (!rl.ok) {
      return rateLimitResponse(bucket, syncKey, rl.retryAfter, 429);
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

    const nowSeconds = now();
    await db
      .prepare('UPDATE users SET last_active_at = ? WHERE sync_key = ? AND (last_active_at IS NULL OR last_active_at <= ?)')
      .bind(nowSeconds, syncKey, nowSeconds - ACTIVITY_WRITE_INTERVAL_SECONDS)
      .run();

    const [feedsRes, flagsRes, serverTime] = await Promise.all([
      db
        .prepare('SELECT * FROM feeds WHERE sync_key = ? AND row_at >= ? ORDER BY row_at ASC')
        .bind(syncKey, since)
        .all(),
      db
        .prepare('SELECT item_id, feed_id, read, read_at, starred, starred_at, row_at FROM flags WHERE sync_key = ? AND row_at >= ? ORDER BY row_at ASC')
        .bind(syncKey, since)
        .all(),
      currentMonotonicTime(db),
    ]);

    return c.json({ serverTime, feeds: feedsRes.results, flags: flagsRes.results });
  });

  app.post('/sync/stats/push', async (c) => {
    const { syncKey } = getSyncKeyContext(c);
    const rl = await checkRateLimit(
      db,
      `stats-push:${syncKey}`,
      RATE_LIMITS.statsPush.windowSeconds,
      RATE_LIMITS.statsPush.limit,
      now(),
    );
    if (!rl.ok) return rateLimitResponse(`stats-push:${syncKey}`, syncKey, rl.retryAfter);

    let body: StatsPushBody;
    try {
      body = (await c.req.json()) as StatsPushBody;
    } catch {
      return jsonError('Invalid JSON body', 'body');
    }
    const stats = Array.isArray(body.stats) ? body.stats : [];
    const markers = Array.isArray(body.markers) ? body.markers : [];
    if (stats.length + markers.length > MAX_STATS_PER_PUSH) {
      return new Response('Payload too large', { status: 413 });
    }
    for (const row of stats) {
      const err = validateStatsPayload(row);
      if (err) return jsonError(err.message, err.field);
    }
    for (const marker of markers) {
      const err = validateMarkerPayload(marker);
      if (err) return jsonError(err.message, err.field);
    }
    if (stats.length === 0 && markers.length === 0) {
      return c.json({ acknowledged: [], stats: [] });
    }

    const batchT = await nextMonotonicTime(db);
    const stmts: D1PreparedStatement[] = [];
    const feedIds = new Set<string>();
    for (const row of stats) {
      feedIds.add(row.feedId);
      stmts.push(
        db
          .prepare(
            'INSERT OR IGNORE INTO feed_stats (sync_key, feed_id, total_seen, read_once, feed_url, title, row_at) VALUES (?, ?, ?, 0, ?, ?, 0)',
          )
          .bind(syncKey, row.feedId, row.totalSeen, row.feedUrl ?? null, row.title ?? null),
      );
      stmts.push(
        db
          .prepare(
            'UPDATE feed_stats SET total_seen = CASE WHEN total_seen < ? THEN ? ELSE total_seen END, row_at = CASE WHEN total_seen < ? THEN ? ELSE row_at END WHERE sync_key = ? AND feed_id = ?',
          )
          .bind(row.totalSeen, row.totalSeen, row.totalSeen, batchT, syncKey, row.feedId),
      );
    }
    for (const marker of markers) {
      feedIds.add(marker.feedId);
      stmts.push(
        db
          .prepare(
            'INSERT OR IGNORE INTO flags (sync_key, item_id, feed_id, ever_read, row_at) VALUES (?, ?, ?, 0, 0)',
          )
          .bind(syncKey, marker.itemId, marker.feedId),
      );
      stmts.push(
        db
          .prepare('INSERT OR IGNORE INTO feed_stats (sync_key, feed_id, total_seen, read_once, row_at) VALUES (?, ?, 0, 0, 0)')
          .bind(syncKey, marker.feedId),
      );
      stmts.push(
        db
          .prepare('UPDATE flags SET ever_read = ?, row_at = ? WHERE sync_key = ? AND item_id = ? AND ever_read = 0')
          .bind(1, batchT, syncKey, marker.itemId),
      );
      stmts.push(
        db
          .prepare(
            'UPDATE feed_stats SET read_once = read_once + 1, total_seen = CASE WHEN total_seen < read_once + 1 THEN read_once + 1 ELSE total_seen END, row_at = ? WHERE sync_key = ? AND feed_id = ? AND changes() = 1',
          )
          .bind(batchT, syncKey, marker.feedId),
      );
    }
    await db.batch(stmts);

    const authoritative: unknown[] = [];
    for (const feedId of feedIds) {
      const row = await db
        .prepare('SELECT feed_id, total_seen, read_once, feed_url, title, row_at FROM feed_stats WHERE sync_key = ? AND feed_id = ?')
        .bind(syncKey, feedId)
        .first();
      if (row) authoritative.push(row);
    }
    return c.json({ acknowledged: markers.map((marker) => marker.itemId), stats: authoritative });
  });

  app.get('/sync/stats/pull', async (c) => {
    c.header('Cache-Control', 'no-store');
    const ctx = getSyncKeyContext(c);
    const { syncKey } = ctx;
    const bucket = rateLimitKey(ctx, 'stats-pull');
    const rl = await checkRateLimit(
      db,
      bucket,
      RATE_LIMITS.statsPull.windowSeconds,
      RATE_LIMITS.statsPull.limit,
      now(),
    );
    if (!rl.ok) return rateLimitResponse(bucket, syncKey, rl.retryAfter);

    const sinceRaw = c.req.query('since');
    let since = 0;
    if (sinceRaw !== undefined && sinceRaw !== '' && sinceRaw !== 'null') {
      const n = Number(sinceRaw);
      if (!Number.isFinite(n) || n < 0) return jsonError('Invalid `since` query parameter', 'since');
      since = Math.floor(n);
    }
    const [statsRes, markersRes, serverTime] = await Promise.all([
      db
        .prepare('SELECT feed_id, total_seen, read_once, feed_url, title, row_at FROM feed_stats WHERE sync_key = ? AND row_at >= ? ORDER BY row_at ASC')
        .bind(syncKey, since)
        .all(),
      db
        .prepare('SELECT item_id, feed_id, row_at FROM flags WHERE sync_key = ? AND ever_read = 1 AND row_at >= ? ORDER BY row_at ASC')
        .bind(syncKey, since)
        .all(),
      currentMonotonicTime(db),
    ]);
    return c.json({ serverTime, stats: statsRes.results, markers: markersRes.results });
  });

  // GET /sync/items?after=<seq> — retained server-polled items for the
  // caller's live subscriptions (up to the per-account polling cap),
  // paginated by insertion sequence. Only available with a poll database.
  app.get('/sync/items', async (c) => {
    if (!pollDb) return c.text('Not Found', 404);
    c.header('Cache-Control', 'no-store');
    const ctx = getSyncKeyContext(c);
    const { syncKey } = ctx;
    const bucket = rateLimitKey(ctx, 'items-pull');
    const rl = await checkRateLimit(
      db,
      bucket,
      RATE_LIMITS.itemsPull.windowSeconds,
      RATE_LIMITS.itemsPull.limit,
      now(),
    );
    if (!rl.ok) return rateLimitResponse(bucket, syncKey, rl.retryAfter);

    const after = parseCursor(c.req.query('after'));
    if (after === null) return jsonError('Invalid `after` query parameter', 'after');

    const [feedsRes, maxRow] = await Promise.all([
      db
        .prepare(
          `SELECT feed_id, feed_url FROM feeds
           WHERE sync_key = ? AND deleted = 0 AND feed_url IS NOT NULL AND feed_url != ''
           ORDER BY feed_id LIMIT ?`,
        )
        .bind(syncKey, MAX_POLLED_FEEDS_PER_ACCOUNT)
        .all<{ feed_id: string; feed_url: string }>(),
      pollDb
        .prepare('SELECT COALESCE(MAX(seq), 0) AS max_seq FROM polled_items')
        .first<{ max_seq: number }>(),
    ]);
    const maxSeq = maxRow?.max_seq ?? 0;
    const feedIdByUrl = new Map<string, string>();
    for (const row of feedsRes.results) {
      if (!feedIdByUrl.has(row.feed_url)) feedIdByUrl.set(row.feed_url, row.feed_id);
    }
    if (feedIdByUrl.size === 0) return c.json({ items: [], cursor: maxSeq, more: false });

    const from = after > maxSeq ? 0 : after;
    const res = await pollDb
      .prepare(
        `SELECT seq, feed_url, guid, title, link, author, published_at, excerpt, html, thumbnail, first_seen_at
         FROM polled_items
         WHERE feed_url IN (SELECT value FROM json_each(?)) AND seq > ? AND seq <= ?
         ORDER BY seq ASC
         LIMIT ?`,
      )
      .bind(JSON.stringify([...feedIdByUrl.keys()]), from, maxSeq, ITEMS_PAGE_SIZE)
      .all<{ seq: number; feed_url: string } & Record<string, unknown>>();
    const items = res.results.map(({ feed_url: feedUrl, ...item }) => ({ ...item, feed_id: feedIdByUrl.get(feedUrl) }));
    const more = items.length === ITEMS_PAGE_SIZE;
    const cursor = more ? items[items.length - 1].seq : maxSeq;
    return c.json({ items, cursor, more });
  });

  return app;
}
