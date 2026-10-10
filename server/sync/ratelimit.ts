/**
 * In-Worker rate limiting backed by D1.
 *
 * Uses a fixed-window algorithm. The counter row is upserted via
 * `INSERT ... ON CONFLICT DO UPDATE SET count = count + 1` — NOT
 * `INSERT OR REPLACE`. The latter would delete the existing row
 * first, making `count + 1` evaluate against a non-existent row
 * (NULL), so the counter would never increment.
 *
 * For personal RSS reader usage the TOCTOU between the SELECT
 * and the upsert is acceptable: a personal device's request rate
 * is far below the per-window limit, and any overshoot is bounded
 * by request concurrency (not unbounded growth).
 */

export interface RateLimitResult {
  ok: boolean;
  /** Seconds to wait before retrying. Only meaningful when `ok` is false. */
  retryAfter: number;
}

export async function checkRateLimit(
  db: D1Database,
  scope: string,
  windowSeconds: number,
  limit: number,
  nowSeconds: number = Math.floor(Date.now() / 1000),
): Promise<RateLimitResult> {
  const windowStart = Math.floor(nowSeconds / windowSeconds) * windowSeconds;
  const windowEnd = windowStart + windowSeconds;

  const current = await db
    .prepare('SELECT count FROM rate_limits WHERE scope = ? AND window_start = ?')
    .bind(scope, windowStart)
    .first<{ count: number }>();

  if (current && current.count >= limit) {
    return { ok: false, retryAfter: Math.max(1, windowEnd - nowSeconds) };
  }

  await db
    .prepare(
      'INSERT INTO rate_limits (scope, window_start, count) VALUES (?, ?, 1) ' +
        'ON CONFLICT (scope, window_start) DO UPDATE SET count = count + 1',
    )
    .bind(scope, windowStart)
    .run();

  return { ok: true, retryAfter: 0 };
}

export const RATE_LIMITS = {
  registerPerIp: { windowSeconds: 3600, limit: 100 },
  registerGlobal: { windowSeconds: 86400, limit: 1000 },
  otp: { windowSeconds: 3600, limit: 20 },
  redeem: { windowSeconds: 60, limit: 10 },
  push: { windowSeconds: 60, limit: 60 },
  pull: { windowSeconds: 60, limit: 60 },
  tokensMint: { windowSeconds: 3600, limit: 20 },
  tokensRedeem: { windowSeconds: 60, limit: 10 },
  rotate: { windowSeconds: 3600, limit: 20 },
  statsPush: { windowSeconds: 60, limit: 60 },
  statsPull: { windowSeconds: 60, limit: 60 },
  itemsPull: { windowSeconds: 60, limit: 120 },
  accountDelete: { windowSeconds: 3600, limit: 10 },
  discover: { windowSeconds: 60, limit: 20 },
  connectionsMint: { windowSeconds: 3600, limit: 20 },
  oauthRegister: { windowSeconds: 3600, limit: 30 },
  oauthAuthorize: { windowSeconds: 60, limit: 60 },
  oauthToken: { windowSeconds: 60, limit: 120 },
  approvalLookupIp: { windowSeconds: 60, limit: 60 },
  approvalLookupKey: { windowSeconds: 60, limit: 20 },
  mcp: { windowSeconds: 60, limit: 120 },
} as const;

export const KEYED_RATE_LIMIT_PREFIXES = [
  'rotate',
  'otp',
  'tokens:mint',
  'push',
  'pull',
  'stats-push',
  'stats-pull',
  'items-pull',
  'account-delete',
  'discover',
  'connections:mint',
  'approval:key',
] as const;
