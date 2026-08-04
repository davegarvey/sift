/**
 * Monotonic server time.
 *
 * Wall-clock sources (Date.now, unixepoch, etc.) are NOT monotonic — NTP
 * slew, container pauses, and Cloudflare infrastructure migrations can
 * all cause the clock to jump backward. A regression would break the
 * `since=X` pull model (rows stamped at the higher time are skipped on
 * the next pull).
 *
 * Instead, every server-side timestamp is sourced from a D1 counter that
 * is anchored to the wall clock: each assignment stores
 * `max(value + 1, Date.now())`, so values stay in the epoch-millisecond
 * scale (comparable with client stamps and the pull cursor) while
 * remaining strictly increasing. SQLite serializes writes, so the
 * read-modify-write is atomic; for a personal RSS reader, contention is
 * negligible.
 */

const WALL = Date.now;

export async function nextMonotonicTime(db: D1Database): Promise<number> {
  await db
    .prepare('INSERT OR IGNORE INTO counters (name, value) VALUES (?, 0)')
    .bind('server_time')
    .run();
  const row = await db
    .prepare(
      "UPDATE counters SET value = CASE WHEN value + 1 > ? THEN value + 1 ELSE ? END WHERE name = 'server_time' RETURNING value",
    )
    .bind(WALL(), WALL())
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
  // Persist the wall bump so a later batch can never stamp a row_at below
  // the serverTime reported to a client (which would skip delivery).
  const row = await db
    .prepare(
      "UPDATE counters SET value = CASE WHEN ? > value THEN ? ELSE value END WHERE name = 'server_time' RETURNING value",
    )
    .bind(WALL(), WALL())
    .first<{ value: number }>();
  return row?.value ?? 0;
}
