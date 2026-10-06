/**
 * Account deletion shared by `DELETE /sync/account` and the daily retention
 * cron. An account is the `users` row plus every row keyed by its sync key.
 * Shared state keyed by hashes of URLs or origins (`feed_fetch_failures`,
 * `upstream_origin_policy`) and the `counters` table are not account data and
 * are left alone.
 */

import { KEYED_RATE_LIMIT_PREFIXES } from './ratelimit';

export function accountDeletionStatements(
  db: D1Database,
  syncKey: string,
  options: { rateLimits: boolean },
): D1PreparedStatement[] {
  const statements = [
    db.prepare('DELETE FROM flags WHERE sync_key = ?').bind(syncKey),
    db.prepare('DELETE FROM feed_stats WHERE sync_key = ?').bind(syncKey),
    db.prepare('DELETE FROM feeds WHERE sync_key = ?').bind(syncKey),
    db.prepare('DELETE FROM tokens WHERE sync_key = ?').bind(syncKey),
    db.prepare('DELETE FROM pairing_codes WHERE sync_key = ?').bind(syncKey),
  ];
  if (options.rateLimits) {
    for (const prefix of KEYED_RATE_LIMIT_PREFIXES) {
      statements.push(db.prepare('DELETE FROM rate_limits WHERE scope = ?').bind(`${prefix}:${syncKey}`));
    }
  }
  statements.push(db.prepare('DELETE FROM users WHERE sync_key = ?').bind(syncKey));
  return statements;
}

export async function deleteAccount(
  db: D1Database,
  syncKey: string,
  options: { rateLimits: boolean },
): Promise<void> {
  await db.batch(accountDeletionStatements(db, syncKey, options));
}

export async function accountFeedUrls(db: D1Database, syncKey: string): Promise<string[]> {
  const res = await db
    .prepare("SELECT DISTINCT feed_url FROM feeds WHERE sync_key = ? AND feed_url IS NOT NULL AND feed_url != ''")
    .bind(syncKey)
    .all<{ feed_url: string }>();
  return res.results.map((row) => row.feed_url);
}
