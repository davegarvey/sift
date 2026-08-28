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
} as const;

/**
 * In-memory windowed rate limiter (per isolate).
 *
 * Used where a D1-backed counter would make the guard the attack surface:
 * code-pull brute-force attempts would each upsert a `rate_limits` row, so
 * a distributed guessing campaign would drain the shared D1 write quota.
 * Memory counters cost nothing and still stop a single source. They are
 * approximate across isolates (an attacker rotating edges multiplies
 * budget) — that is the documented bound for a 40-bit, 5-minute code.
 */
const memoryBuckets = new Map<string, { windowStart: number; count: number }>();
const MEMORY_BUCKET_SWEEP = 10_000;

export function checkMemoryRateLimit(
  scope: string,
  windowSeconds: number,
  limit: number,
  nowSeconds: number = Math.floor(Date.now() / 1000),
): RateLimitResult {
  if (memoryBuckets.size >= MEMORY_BUCKET_SWEEP) {
    for (const [key, bucket] of memoryBuckets) {
      if (bucket.windowStart < nowSeconds - windowSeconds) memoryBuckets.delete(key);
    }
  }
  const windowStart = Math.floor(nowSeconds / windowSeconds) * windowSeconds;
  const windowEnd = windowStart + windowSeconds;
  const bucket = memoryBuckets.get(scope);
  if (!bucket || bucket.windowStart !== windowStart) {
    memoryBuckets.set(scope, { windowStart, count: 1 });
    return { ok: true, retryAfter: 0 };
  }
  if (bucket.count >= limit) {
    return { ok: false, retryAfter: Math.max(1, windowEnd - nowSeconds) };
  }
  bucket.count += 1;
  return { ok: true, retryAfter: 0 };
}
