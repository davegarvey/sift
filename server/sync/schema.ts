export async function ensureSchema(db: D1Database): Promise<void> {
  // v1→v2 migration: feed_id replaces feed_url as PK. Use a tracking table so
  // it only runs once (in production D1) and is a no-op on subsequent cold
  // starts. The local-d1 shim starts empty every time, so the migration always
  // runs on first call — which is correct because there's no persisted data.
  await db.prepare('CREATE TABLE IF NOT EXISTS _schema_migrate_v2 (done INTEGER PRIMARY KEY)').run();
  const row = await db.prepare('SELECT done FROM _schema_migrate_v2 WHERE done = 1').first<{ done: number }>();
  if (!row) {
    await db.prepare('DROP TABLE IF EXISTS feeds').run();
    await db.prepare('DROP TABLE IF EXISTS flags').run();
    await db.prepare('INSERT INTO _schema_migrate_v2 (done) VALUES (1)').run();
  }

  const statements = [
    `CREATE TABLE IF NOT EXISTS users (
      sync_key   TEXT PRIMARY KEY,
      created_at INTEGER NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS feeds (
      sync_key    TEXT NOT NULL,
      feed_id     TEXT NOT NULL,
      feed_url    TEXT,
      feed_url_at INTEGER,
      folder      TEXT,
      folder_at   INTEGER,
      title       TEXT,
      title_at    INTEGER,
      tags        TEXT,
      tags_at     INTEGER,
      deleted     INTEGER NOT NULL DEFAULT 0,
      deleted_at  INTEGER,
      row_at      INTEGER NOT NULL,
      PRIMARY KEY (sync_key, feed_id)
    )`,
    `CREATE TABLE IF NOT EXISTS flags (
      sync_key   TEXT NOT NULL,
      item_id    TEXT NOT NULL,
      feed_id    TEXT NOT NULL,
      read       INTEGER,
      read_at    INTEGER,
      starred    INTEGER,
      starred_at INTEGER,
      row_at     INTEGER NOT NULL,
      PRIMARY KEY (sync_key, item_id)
    )`,
    `CREATE TABLE IF NOT EXISTS pairing_codes (
      code        TEXT PRIMARY KEY,
      sync_key    TEXT NOT NULL,
      expires_at  INTEGER NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS counters (
      name  TEXT PRIMARY KEY,
      value INTEGER NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS rate_limits (
      scope         TEXT NOT NULL,
      window_start  INTEGER NOT NULL,
      count         INTEGER NOT NULL,
      PRIMARY KEY (scope, window_start)
    )`,
    `CREATE INDEX IF NOT EXISTS idx_feeds_row_at    ON feeds(sync_key, row_at)`,
    `CREATE INDEX IF NOT EXISTS idx_flags_row_at    ON flags(sync_key, row_at)`,
    `CREATE INDEX IF NOT EXISTS idx_flags_feed_id   ON flags(sync_key, feed_id)`,
    `CREATE INDEX IF NOT EXISTS idx_pairing_expires ON pairing_codes(expires_at)`,
    `CREATE INDEX IF NOT EXISTS idx_rate_limits_window ON rate_limits(window_start)`,
  ];
  for (const sql of statements) {
    await db.prepare(sql).run();
  }
}
