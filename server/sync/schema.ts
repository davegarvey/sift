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
      html_url    TEXT,
      html_url_at INTEGER,
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
      ever_read  INTEGER NOT NULL DEFAULT 0,
      row_at     INTEGER NOT NULL,
      PRIMARY KEY (sync_key, item_id)
    )`,
    `CREATE TABLE IF NOT EXISTS feed_stats (
      sync_key   TEXT NOT NULL,
      feed_id    TEXT NOT NULL,
      total_seen INTEGER NOT NULL DEFAULT 0,
      read_once  INTEGER NOT NULL DEFAULT 0,
      feed_url   TEXT,
      title      TEXT,
      row_at     INTEGER NOT NULL,
      PRIMARY KEY (sync_key, feed_id)
    )`,
    `CREATE TABLE IF NOT EXISTS pairing_codes (
      code        TEXT PRIMARY KEY,
      sync_key    TEXT NOT NULL,
      expires_at  INTEGER NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS tokens (
      token_id         TEXT PRIMARY KEY,
      token_hash       TEXT NOT NULL UNIQUE,
      sync_key         TEXT NOT NULL,
      scope            TEXT NOT NULL DEFAULT 'rw',
      fingerprint      TEXT NOT NULL,
      created_at       INTEGER NOT NULL,
      last_seen_at     INTEGER,
      last_seen_minute INTEGER
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
    `CREATE INDEX IF NOT EXISTS idx_feed_stats_row_at ON feed_stats(sync_key, row_at)`,
    `CREATE INDEX IF NOT EXISTS idx_pairing_expires ON pairing_codes(expires_at)`,
    `CREATE INDEX IF NOT EXISTS idx_tokens_sync_key ON tokens(sync_key)`,
    `CREATE INDEX IF NOT EXISTS idx_rate_limits_window ON rate_limits(window_start)`,
  ];
  await db.batch(statements.map((sql) => db.prepare(sql)));

  // Migrations: additive columns on existing tables.
  const migrations = [
    `ALTER TABLE feeds ADD COLUMN html_url TEXT`,
    `ALTER TABLE feeds ADD COLUMN html_url_at INTEGER`,
    `ALTER TABLE pairing_codes ADD COLUMN kind TEXT NOT NULL DEFAULT 'device'`,
    `ALTER TABLE users ADD COLUMN rotated_at INTEGER`,
    `ALTER TABLE flags ADD COLUMN ever_read INTEGER NOT NULL DEFAULT 0`,
  ];
  for (const sql of migrations) {
    try {
      await db.prepare(sql).run();
    } catch {
      // Column already exists — swallow the error.
    }
  }

  // Index on a migrated column must be created after the ALTER.
  try {
    await db.prepare('CREATE INDEX IF NOT EXISTS idx_pairing_kind ON pairing_codes(kind)').run();
  } catch {
    // kind column missing — swallow the error.
  }
  try {
    await db.prepare('CREATE INDEX IF NOT EXISTS idx_flags_ever_read ON flags(sync_key, ever_read, row_at)').run();
  } catch {
    // ever_read column missing on an unsupported legacy schema.
  }
}
