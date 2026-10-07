/**
 * Scheduled cron handler — runs daily at 03:00 UTC.
 *
 * - Deletes tombstoned feeds older than 30 days.
 * - Deletes expired pairing codes (older than 1 day past expiry).
 * - Deletes rate-limit rows outside the largest window.
 * - Deletes expired shared feed failure rows.
 * - Deletes idle origin reservation rows after their cooldown and retention expire.
 * - Deletes accounts, with all their rows, that were rotated away more than
 *   30 days ago or have had no sync activity for 365 days, at most
 *   RETENTION_MAX_ACCOUNTS_PER_RUN per run (rotated accounts first); a backlog
 *   is cleared over later runs.
 */

import { deleteAccount } from './account';
import { currentMonotonicTime } from './monotonic';
import { STATE_RETENTION_MS } from '../origin-governor';

const TOMBSTONE_RETENTION_DAYS = 30;
const PAIRING_GRACE_DAYS = 1;
const RATE_LIMIT_MAX_WINDOW_SECONDS = 24 * 60 * 60; // the daily register:global window
export const ROTATED_ACCOUNT_RETENTION_DAYS = 30;
export const INACTIVE_ACCOUNT_RETENTION_DAYS = 365;
export const RETENTION_MAX_ACCOUNTS_PER_RUN = 50;

async function expiredAccountKeys(db: D1Database, nowSeconds: number): Promise<string[]> {
  const day = 24 * 60 * 60;
  const rotatedCutoff = nowSeconds - ROTATED_ACCOUNT_RETENTION_DAYS * day;
  const inactiveCutoff = nowSeconds - INACTIVE_ACCOUNT_RETENTION_DAYS * day;
  const keys: string[] = [];
  const queries: Array<[string, number]> = [
    ['SELECT sync_key FROM users WHERE rotated_at < ? LIMIT ?', rotatedCutoff],
    ['SELECT sync_key FROM users WHERE rotated_at IS NULL AND last_active_at < ? LIMIT ?', inactiveCutoff],
    ['SELECT sync_key FROM users WHERE rotated_at IS NULL AND last_active_at IS NULL AND created_at < ? LIMIT ?', inactiveCutoff],
  ];
  for (const [sql, cutoff] of queries) {
    const remaining = RETENTION_MAX_ACCOUNTS_PER_RUN - keys.length;
    if (remaining <= 0) break;
    const res = await db.prepare(sql).bind(cutoff, remaining).all<{ sync_key: string }>();
    for (const row of res.results) keys.push(row.sync_key);
  }
  return keys;
}

export async function runSyncCron(db: D1Database, scheduledTime: number = Date.now()): Promise<void> {
  await db.prepare(
    `CREATE TABLE IF NOT EXISTS upstream_origin_policy (
      origin_key TEXT PRIMARY KEY,
      next_request_at INTEGER NOT NULL DEFAULT 0,
      cooldown_until INTEGER NOT NULL DEFAULT 0,
      cooldown_status INTEGER,
      challenge_count INTEGER NOT NULL DEFAULT 0,
      updated_at INTEGER NOT NULL
    )`,
  ).run();
  const now = scheduledTime;
  const tombstoneCutoff = now - TOMBSTONE_RETENTION_DAYS * 24 * 60 * 60 * 1000;
  const pairingCutoff = Math.floor(now / 1000) - PAIRING_GRACE_DAYS * 24 * 60 * 60;
  const rateLimitCutoff = Math.floor(now / 1000) - RATE_LIMIT_MAX_WINDOW_SECONDS;

  await db.batch([
    db
      .prepare('DELETE FROM feeds WHERE deleted = 1 AND deleted_at < ?')
      .bind(tombstoneCutoff),
    db.prepare('DELETE FROM pairing_codes WHERE expires_at < ?').bind(pairingCutoff),
    db
      .prepare('DELETE FROM rate_limits WHERE window_start < ?')
      .bind(rateLimitCutoff),
    db
      .prepare('DELETE FROM feed_fetch_failures WHERE retry_at < ?')
      .bind(now),
    db.prepare(
      'DELETE FROM upstream_origin_policy WHERE cooldown_until < ? AND next_request_at < ? AND updated_at < ?',
    ).bind(now, now, now - STATE_RETENTION_MS),
  ]);

  let retentionError: unknown;
  for (const syncKey of await expiredAccountKeys(db, Math.floor(now / 1000))) {
    try {
      await deleteAccount(db, syncKey, { rateLimits: false });
    } catch (err) {
      retentionError ??= err;
    }
  }

  // Touch the monotonic counter so a long-idle DB doesn't serve a stale "0".
  await currentMonotonicTime(db);
  if (retentionError !== undefined) throw retentionError;
}
