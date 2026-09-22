import { sha256Hex } from './sync/tokens';

export const ORIGIN_MIN_INTERVAL_MS = 1_000;
export const ORIGIN_MAX_QUEUE_WAIT_MS = 5_000;
export const ORIGIN_MAX_IN_FLIGHT = 4;
export const ORIGIN_MAX_WAITERS = 16;
const ORIGIN_RETRY_FALLBACK_MS = 30 * 60_000;
const CHALLENGE_RETRY_MS = [6, 12, 24].map((hours) => hours * 60 * 60_000);
const STATE_RETENTION_MS = 7 * 24 * 60 * 60_000;
const ALLOWED_METADATA_HEADERS = ['server', 'via', 'cf-ray', 'x-cache', 'content-type'];

export type UpstreamRoute = 'feed' | 'article' | 'image' | 'discovery' | 'mcp';

export interface OriginPolicyOptions {
  db?: D1Database;
  route: UpstreamRoute;
}

interface OriginRow {
  next_request_at: number;
  cooldown_until: number;
  cooldown_status: number | null;
  challenge_count: number;
}

interface Waiter {
  resolve: (release: (() => void) | null) => void;
  timer: ReturnType<typeof setTimeout>;
}

interface RuntimeOriginState {
  originKey: Promise<string>;
  active: number;
  waiters: Waiter[];
  nextRequestAt: number;
  cooldownUntil: number;
  cooldownStatus: number;
  challengeCount: number;
  lastUsedAt: number;
}

type Reservation =
  | { ok: true; release: () => void }
  | { ok: false; response: Response };

const runtimeOrigins = new Map<string, RuntimeOriginState>();
const schemaReady = new WeakMap<D1Database, Promise<void>>();
let loggedD1Fallback = false;

function stateFor(origin: string): RuntimeOriginState {
  const now = Date.now();
  let state = runtimeOrigins.get(origin);
  if (!state) {
    if (runtimeOrigins.size > 256) {
      for (const [key, candidate] of runtimeOrigins) {
        if (
          candidate.active === 0 && candidate.waiters.length === 0 &&
          candidate.cooldownUntil <= now && candidate.nextRequestAt <= now &&
          candidate.lastUsedAt < now - STATE_RETENTION_MS
        ) runtimeOrigins.delete(key);
      }
    }
    state = {
      originKey: sha256Hex(origin),
      active: 0,
      waiters: [],
      nextRequestAt: 0,
      cooldownUntil: 0,
      cooldownStatus: 429,
      challengeCount: 0,
      lastUsedAt: now,
    };
    runtimeOrigins.set(origin, state);
  }
  state.lastUsedAt = now;
  return state;
}

function diagnostic(event: string, fields: Record<string, string | number | null>): void {
  console.info(JSON.stringify({ event: `upstream_policy.${event}`, ...fields }));
}

function originHash(origin: string): Promise<string> {
  return stateFor(origin).originKey;
}

async function ensureSchema(db: D1Database): Promise<void> {
  let ready = schemaReady.get(db);
  if (!ready) {
    ready = db.prepare(
      `CREATE TABLE IF NOT EXISTS upstream_origin_policy (
        origin_key TEXT PRIMARY KEY,
        next_request_at INTEGER NOT NULL DEFAULT 0,
        cooldown_until INTEGER NOT NULL DEFAULT 0,
        cooldown_status INTEGER,
        challenge_count INTEGER NOT NULL DEFAULT 0,
        updated_at INTEGER NOT NULL
      )`,
    ).run().then(() => undefined);
    schemaReady.set(db, ready);
  }
  try {
    await ready;
  } catch (error) {
    if (schemaReady.get(db) === ready) schemaReady.delete(db);
    throw error;
  }
}

async function readD1State(db: D1Database, key: string): Promise<OriginRow | undefined> {
  await ensureSchema(db);
  const row = await db.prepare(
    'SELECT next_request_at, cooldown_until, cooldown_status, challenge_count FROM upstream_origin_policy WHERE origin_key = ?',
  ).bind(key).first<OriginRow>();
  return row ?? undefined;
}

function localCooldownResponse(status: number, retryAt: number, source: string): Response {
  const retryAfter = Math.max(1, Math.ceil((retryAt - Date.now()) / 1000));
  return new Response(null, {
    status,
    headers: {
      'Cache-Control': 'no-store',
      'Retry-After': String(retryAfter),
      'X-Sift-Request-Source': source,
    },
  });
}

function localGateResponse(retryAt: number): Response {
  return localCooldownResponse(429, retryAt, 'local-gate');
}

function releasePermit(state: RuntimeOriginState): () => void {
  let released = false;
  return () => {
    if (released) return;
    released = true;
    state.active = Math.max(0, state.active - 1);
    while (state.active < ORIGIN_MAX_IN_FLIGHT && state.waiters.length > 0) {
      const waiter = state.waiters.shift()!;
      clearTimeout(waiter.timer);
      state.active += 1;
      waiter.resolve(releasePermit(state));
    }
  };
}

function acquireRuntimePermit(state: RuntimeOriginState, originKey: string, route: UpstreamRoute): Promise<(() => void) | null> {
  if (state.active < ORIGIN_MAX_IN_FLIGHT && state.waiters.length === 0) {
    state.active += 1;
    return Promise.resolve(releasePermit(state));
  }
  if (state.waiters.length >= ORIGIN_MAX_WAITERS) {
    diagnostic('queue_rejected', { route, originHash: originKey, status: 429, reason: 'queue_full', source: 'local-gate' });
    return Promise.resolve(null);
  }
  return new Promise((resolve) => {
    const waiter: Waiter = {
      resolve,
      timer: setTimeout(() => {
        const index = state.waiters.indexOf(waiter);
        if (index >= 0) state.waiters.splice(index, 1);
        diagnostic('queue_rejected', { route, originHash: originKey, status: 429, reason: 'queue_timeout', source: 'local-gate' });
        resolve(null);
      }, ORIGIN_MAX_QUEUE_WAIT_MS),
    };
    state.waiters.push(waiter);
  });
}

async function reserveD1Slot(
  db: D1Database,
  key: string,
  now: number,
): Promise<{ reservedAt: number; row: OriginRow } | { blocked: OriginRow }> {
  await ensureSchema(db);
  const result = await db.prepare(
    `INSERT INTO upstream_origin_policy
      (origin_key, next_request_at, cooldown_until, cooldown_status, challenge_count, updated_at)
     VALUES (?, ?, 0, NULL, 0, ?)
     ON CONFLICT(origin_key) DO UPDATE SET
      next_request_at = MAX(upstream_origin_policy.next_request_at, ?) + ?,
      updated_at = ?
     WHERE upstream_origin_policy.cooldown_until <= ?
       AND upstream_origin_policy.next_request_at <= ?
     RETURNING next_request_at, cooldown_until, cooldown_status, challenge_count`,
  ).bind(
    key,
    now + ORIGIN_MIN_INTERVAL_MS,
    now,
    now,
    ORIGIN_MIN_INTERVAL_MS,
    now,
    now,
    now + ORIGIN_MAX_QUEUE_WAIT_MS,
  ).first<OriginRow>();

  if (result) return { reservedAt: result.next_request_at - ORIGIN_MIN_INTERVAL_MS, row: result };
  const row = await readD1State(db, key);
  if (row) return { blocked: row };
  throw new Error('Origin reservation returned no state');
}

async function waitForSlot(state: RuntimeOriginState, slotAt: number, route: UpstreamRoute, originKey: string): Promise<boolean> {
  const waitMs = slotAt - Date.now();
  if (waitMs > ORIGIN_MAX_QUEUE_WAIT_MS) {
    diagnostic('queue_rejected', { route, originHash: originKey, status: 429, reason: 'slot_too_far', waitMs, source: 'local-gate' });
    return false;
  }
  if (waitMs > 0) await new Promise<void>((resolve) => setTimeout(resolve, waitMs));
  state.nextRequestAt = Math.max(state.nextRequestAt, slotAt + ORIGIN_MIN_INTERVAL_MS);
  return true;
}

async function reserveOrigin(origin: string, options: OriginPolicyOptions): Promise<Reservation> {
  const key = await originHash(origin);
  const state = stateFor(origin);
  const release = await acquireRuntimePermit(state, key, options.route);
  if (!release) return { ok: false, response: localGateResponse(Date.now() + ORIGIN_MAX_QUEUE_WAIT_MS) };

  try {
    const now = Date.now();
    let row: OriginRow | undefined;
    let sharedSlot: number | undefined;
    if (state.cooldownUntil > now) {
      release();
      diagnostic('cooldown_blocked', {
        route: options.route,
        originHash: key,
        status: state.cooldownStatus,
        retryAfterMs: state.cooldownUntil - now,
        source: 'origin-cooldown',
      });
      return { ok: false, response: localCooldownResponse(state.cooldownStatus, state.cooldownUntil, 'origin-cooldown') };
    }

    if (options.db) {
      try {
        const result = await reserveD1Slot(options.db, key, now);
        if ('blocked' in result) {
          row = result.blocked;
          if (row.cooldown_until > now) {
            state.cooldownUntil = Math.max(state.cooldownUntil, row.cooldown_until);
            state.cooldownStatus = row.cooldown_status ?? 429;
            state.challengeCount = Math.max(state.challengeCount, row.challenge_count);
            release();
            diagnostic('cooldown_blocked', {
              route: options.route,
              originHash: key,
              status: state.cooldownStatus,
              retryAfterMs: state.cooldownUntil - now,
              source: 'origin-cooldown',
            });
            return { ok: false, response: localCooldownResponse(state.cooldownStatus, state.cooldownUntil, 'origin-cooldown') };
          }
          const retryAt = Math.max(now + 1_000, row.next_request_at);
          diagnostic('queue_rejected', { route: options.route, originHash: key, status: 429, reason: 'shared_queue_full', source: 'local-gate' });
          release();
          return { ok: false, response: localGateResponse(retryAt) };
        }
        sharedSlot = result.reservedAt;
        row = result.row;
        state.challengeCount = Math.max(state.challengeCount, row.challenge_count);
      } catch {
        if (!loggedD1Fallback) {
          loggedD1Fallback = true;
          diagnostic('d1_fallback', { route: options.route, originHash: key, reason: 'd1_unavailable' });
        }
      }
    }

    const localSlot = Math.max(now, state.nextRequestAt);
    const slotAt = Math.max(localSlot, sharedSlot ?? localSlot);
    if (!await waitForSlot(state, slotAt, options.route, key)) {
      release();
      return { ok: false, response: localGateResponse(slotAt) };
    }
    return { ok: true, release };
  } catch (error) {
    release();
    throw error;
  }
}

function parseRetryAfter(value: string | null, now: number): number | undefined {
  if (value == null) return undefined;
  const trimmed = value.trim();
  if (/^\d+$/.test(trimmed)) {
    const seconds = Number(trimmed);
    if (!Number.isSafeInteger(seconds)) return undefined;
    return Math.min(seconds * 1000, Number.MAX_SAFE_INTEGER - now);
  }
  const date = Date.parse(trimmed);
  return Number.isFinite(date) ? Math.max(0, date - now) : undefined;
}

async function recordCooldown(
  origin: string,
  response: Response,
  options: OriginPolicyOptions,
): Promise<{ retryAt: number; delayMs: number }> {
  const now = Date.now();
  const state = stateFor(origin);
  const key = await originHash(origin);
  const retryAfter = parseRetryAfter(response.headers.get('Retry-After'), now);
  let delayMs = retryAfter ?? (response.status === 419 ? CHALLENGE_RETRY_MS[Math.min(state.challengeCount, 2)] : ORIGIN_RETRY_FALLBACK_MS);
  let retryAt = now + delayMs;
  let cooldownStatus = response.status;

  if (options.db) {
    try {
      await ensureSchema(options.db);
      const stored = await options.db.prepare(
        `INSERT INTO upstream_origin_policy
          (origin_key, next_request_at, cooldown_until, cooldown_status, challenge_count, updated_at)
         VALUES (?, 0, ?, ?, ?, ?)
         ON CONFLICT(origin_key) DO UPDATE SET
          cooldown_until = MAX(
            upstream_origin_policy.cooldown_until,
            excluded.cooldown_until,
            CASE WHEN excluded.cooldown_status = 419 AND ? = 0 THEN
              ? + CASE upstream_origin_policy.challenge_count
                WHEN 0 THEN ? WHEN 1 THEN ? ELSE ? END
            ELSE excluded.cooldown_until END
          ),
          cooldown_status = CASE
            WHEN excluded.cooldown_until >= upstream_origin_policy.cooldown_until THEN excluded.cooldown_status
            ELSE upstream_origin_policy.cooldown_status END,
          challenge_count = upstream_origin_policy.challenge_count + CASE WHEN excluded.cooldown_status = 419 THEN 1 ELSE 0 END,
          updated_at = excluded.updated_at
         RETURNING cooldown_until, cooldown_status, challenge_count`,
      ).bind(
        key,
        retryAt,
        response.status,
        response.status === 419 ? 1 : 0,
        now,
        retryAfter === undefined ? 0 : 1,
        now,
        CHALLENGE_RETRY_MS[0],
        CHALLENGE_RETRY_MS[1],
        CHALLENGE_RETRY_MS[2],
      ).first<{ cooldown_until: number; cooldown_status: number | null; challenge_count: number }>();
      if (stored) {
        retryAt = stored.cooldown_until;
        state.challengeCount = stored.challenge_count;
        cooldownStatus = stored.cooldown_status ?? response.status;
      }
    } catch {
      if (!loggedD1Fallback) {
        loggedD1Fallback = true;
        diagnostic('d1_fallback', { route: options.route, originHash: key, reason: 'd1_unavailable' });
      }
      if (response.status === 419) state.challengeCount += 1;
    }
  } else if (response.status === 419) {
    state.challengeCount += 1;
  }

  if (retryAt >= state.cooldownUntil) state.cooldownStatus = cooldownStatus;
  state.cooldownUntil = Math.max(state.cooldownUntil, retryAt);
  retryAt = state.cooldownUntil;
  delayMs = Math.max(0, retryAt - now);
  diagnostic('cooldown_recorded', {
    route: options.route,
    originHash: key,
    source: 'upstream',
    status: response.status,
    retryAfterMs: delayMs,
    metadata: safeMetadata(response.headers),
  });
  return { retryAt, delayMs };
}

function safeMetadata(headers: Headers): string {
  const values: string[] = [];
  for (const name of ALLOWED_METADATA_HEADERS) {
    const value = headers.get(name);
    if (value) values.push(`${name}=${value.replace(/[\r\n]/g, '').slice(0, 120)}`);
  }
  return values.join(',');
}

function annotateResponse(response: Response, headers: Headers): Response {
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

export async function fetchOriginRequest(
  url: string,
  init: RequestInit,
  options: OriginPolicyOptions,
): Promise<Response> {
  const origin = new URL(url).origin;
  const reservation = await reserveOrigin(origin, options);
  if (!reservation.ok) return reservation.response;

  let response: Response;
  try {
    response = await fetch(url, init);
  } catch (error) {
    reservation.release();
    throw error;
  }
  try {
    const headers = new Headers(response.headers);
    headers.set('X-Sift-Request-Source', 'upstream');
    if (response.status === 429 || response.status === 419) {
      const cooldown = await recordCooldown(origin, response, options);
      const sentDelay = parseRetryAfter(headers.get('Retry-After'), Date.now()) ?? 0;
      if (!headers.has('Retry-After') || sentDelay < cooldown.delayMs) {
        headers.set('Retry-After', String(Math.max(1, Math.ceil(cooldown.delayMs / 1000))));
      }
    } else if ((response.status >= 200 && response.status < 300) || response.status === 304) {
      const state = stateFor(origin);
      if (state.cooldownUntil <= Date.now()) {
        state.challengeCount = 0;
        if (options.db) {
          try {
            const key = await originHash(origin);
            await options.db.prepare(
              'UPDATE upstream_origin_policy SET challenge_count = 0, updated_at = ? WHERE origin_key = ? AND cooldown_until <= ?',
            ).bind(Date.now(), key, Date.now()).run();
          } catch {
          }
        }
      }
    }
    return annotateResponse(response, headers);
  } finally {
    reservation.release();
  }
}

export function clearOriginGovernorForTests(): void {
  for (const state of runtimeOrigins.values()) {
    for (const waiter of state.waiters) {
      clearTimeout(waiter.timer);
      waiter.resolve(null);
    }
  }
  runtimeOrigins.clear();
  loggedD1Fallback = false;
}

export { STATE_RETENTION_MS };
