/**
 * Scheduled cron handler — runs daily at 03:00 UTC.
 *
 * - Deletes tombstoned feeds older than 30 days.
 * - Deletes expired pairing codes (older than 1 day past expiry).
 * - Deletes rate-limit rows outside the largest window.
 */

import { currentMonotonicTime } from './monotonic';

const TOMBSTONE_RETENTION_DAYS = 30;
const PAIRING_GRACE_DAYS = 1;
const RATE_LIMIT_MAX_WINDOW_SECONDS = 24 * 60 * 60; // the daily register:global window

export async function runSyncCron(db: D1Database, scheduledTime: number = Date.now()): Promise<void> {
  const now = scheduledTime;
  const tombstoneCutoff = now - TOMBSTONE_RETENTION_DAYS * 24 * 60 * 60 * 1000;
  const pairingCutoff = now - PAIRING_GRACE_DAYS * 24 * 60 * 60 * 1000;
  const rateLimitCutoff = Math.floor(now / 1000) - RATE_LIMIT_MAX_WINDOW_SECONDS;

  await db.batch([
    db
      .prepare('DELETE FROM feeds WHERE deleted = 1 AND deleted_at < ?')
      .bind(tombstoneCutoff),
    db.prepare('DELETE FROM pairing_codes WHERE expires_at < ?').bind(pairingCutoff),
    db
      .prepare('DELETE FROM rate_limits WHERE window_start < ?')
      .bind(rateLimitCutoff),
  ]);

  // Touch the monotonic counter so a long-idle DB doesn't serve a stale "0".
  await currentMonotonicTime(db);
}
