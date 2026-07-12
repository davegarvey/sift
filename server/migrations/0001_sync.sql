-- D1 schema for the device-sync feature.
-- All tables are partitioned by sync_key (the user identity).
-- Migrations are applied via `wrangler d1 migrations apply sift-sync`.

-- One row per registered sync key. Created only by POST /sync/register.
CREATE TABLE users (
  sync_key   TEXT PRIMARY KEY,
  created_at INTEGER NOT NULL
);

-- Feed subscriptions with per-field timestamps for PATCH semantics.
-- folder is a JSON-encoded array; null means "no folder" (root).
CREATE TABLE feeds (
  sync_key    TEXT NOT NULL,
  feed_url    TEXT NOT NULL,
  folder      TEXT,
  folder_at   INTEGER,
  title       TEXT,
  title_at    INTEGER,
  deleted     INTEGER NOT NULL DEFAULT 0,
  deleted_at  INTEGER,
  row_at      INTEGER NOT NULL,
  PRIMARY KEY (sync_key, feed_url)
);

-- Item flags with per-field timestamps. feed_url is denormalized
-- from item_id so the server can answer "all flags for feed X" cheaply
-- for unsubscribe-time cleanup.
CREATE TABLE flags (
  sync_key   TEXT NOT NULL,
  item_id    TEXT NOT NULL,
  feed_url   TEXT NOT NULL,
  read       INTEGER,
  read_at    INTEGER,
  starred    INTEGER,
  starred_at INTEGER,
  row_at     INTEGER NOT NULL,
  PRIMARY KEY (sync_key, item_id)
);

-- Short-lived pairing codes for the OTP flow.
-- Codes are server-generated, 8 characters, 30-char alphabet.
CREATE TABLE pairing_codes (
  code        TEXT PRIMARY KEY,
  sync_key    TEXT NOT NULL,
  expires_at  INTEGER NOT NULL
);

-- Monotonic counter. Updated atomically on every server-side
-- timestamp assignment. Survives wall-clock regression.
CREATE TABLE counters (
  name  TEXT PRIMARY KEY,
  value INTEGER NOT NULL
);

-- Rate-limit counters. Scoped per route + per principal.
CREATE TABLE rate_limits (
  scope         TEXT NOT NULL,
  window_start  INTEGER NOT NULL,
  count         INTEGER NOT NULL,
  PRIMARY KEY (scope, window_start)
);

CREATE INDEX idx_feeds_row_at    ON feeds(sync_key, row_at);
CREATE INDEX idx_flags_row_at    ON flags(sync_key, row_at);
CREATE INDEX idx_flags_feed_url  ON flags(sync_key, feed_url);
CREATE INDEX idx_pairing_expires ON pairing_codes(expires_at);
CREATE INDEX idx_rate_limits_window ON rate_limits(window_start);

INSERT INTO counters (name, value) VALUES ('server_time', 0);
