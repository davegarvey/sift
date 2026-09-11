import { sha256Hex } from './sync/tokens';

export interface SharedFeedFailure {
  status: number;
  retryAt: number;
}

const schemaReady = new WeakMap<D1Database, Promise<void>>();

async function ensureSchema(db: D1Database): Promise<void> {
  let ready = schemaReady.get(db);
  if (!ready) {
    ready = db.prepare(
      `CREATE TABLE IF NOT EXISTS feed_fetch_failures (
        feed_key TEXT PRIMARY KEY,
        status INTEGER NOT NULL,
        retry_at INTEGER NOT NULL,
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

async function feedKey(upstream: string): Promise<string> {
  return sha256Hex(upstream);
}

export async function getSharedFeedFailure(
  db: D1Database,
  upstream: string,
  now = Date.now(),
): Promise<SharedFeedFailure | undefined> {
  await ensureSchema(db);
  const key = await feedKey(upstream);
  const row = await db
    .prepare('SELECT status, retry_at FROM feed_fetch_failures WHERE feed_key = ?')
    .bind(key)
    .first<{ status: number; retry_at: number }>();
  if (!row || row.retry_at <= now) return undefined;
  return { status: row.status, retryAt: row.retry_at };
}

export async function recordSharedFeedFailure(
  db: D1Database,
  upstream: string,
  failure: SharedFeedFailure,
  now = Date.now(),
): Promise<void> {
  await ensureSchema(db);
  const key = await feedKey(upstream);
  await db
    .prepare(
      'INSERT INTO feed_fetch_failures (feed_key, status, retry_at, updated_at) VALUES (?, ?, ?, ?) ' +
        'ON CONFLICT(feed_key) DO UPDATE SET status = excluded.status, retry_at = excluded.retry_at, updated_at = excluded.updated_at',
    )
    .bind(key, failure.status, failure.retryAt, now)
    .run();
}

export async function clearSharedFeedFailure(db: D1Database, upstream: string): Promise<void> {
  await ensureSchema(db);
  const key = await feedKey(upstream);
  await db.prepare('DELETE FROM feed_fetch_failures WHERE feed_key = ?').bind(key).run();
}
