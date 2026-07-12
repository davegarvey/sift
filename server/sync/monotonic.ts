/**
 * Monotonic server time.
 *
 * Wall-clock sources (Date.now, unixepoch, etc.) are NOT monotonic — NTP
 * slew, container pauses, and Cloudflare infrastructure migrations can
 * all cause the clock to jump backward. A regression would break the
 * `since=X` pull model (rows stamped at the higher time are skipped on
 * the next pull).
 *
 * Instead, every server-side timestamp is sourced from a D1 counter.
 * SQLite serializes writes, so the `UPDATE ... SET value = value + 1`
 * is atomic. For a personal RSS reader, contention is negligible.
 */

export async function nextMonotonicTime(db: D1Database): Promise<number> {
  await db
    .prepare('INSERT OR IGNORE INTO counters (name, value) VALUES (?, 0)')
    .bind('server_time')
    .run();
  const row = await db
    .prepare(
      "UPDATE counters SET value = value + 1 WHERE name = 'server_time' RETURNING value",
    )
    .first<{ value: number }>();
  if (!row) {
    throw new Error('monotonic time: counter row not found after upsert');
  }
  return row.value;
}

export async function currentMonotonicTime(db: D1Database): Promise<number> {
  await db
    .prepare('INSERT OR IGNORE INTO counters (name, value) VALUES (?, 0)')
    .bind('server_time')
    .run();
  const row = await db
    .prepare("SELECT value FROM counters WHERE name = 'server_time'")
    .first<{ value: number }>();
  return row?.value ?? 0;
}
