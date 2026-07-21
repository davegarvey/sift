export async function ensureSchema(db: D1Database): Promise<void> {
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
