-- Poll database for server-side feed polling (binding POLL_DB).
-- Rows are keyed by feed URL and never carry a sync key.

-- Registry of feed URLs to poll, with validators and schedule.
CREATE TABLE polled_feeds (
  feed_url      TEXT PRIMARY KEY,
  etag          TEXT,
  last_modified TEXT,
  next_poll_at  INTEGER NOT NULL DEFAULT 0,
  failures      INTEGER NOT NULL DEFAULT 0,
  last_status   INTEGER,
  updated_at    INTEGER NOT NULL
);

-- Entries found by polling, retained for 7 days. seq is the /sync/items cursor.
CREATE TABLE polled_items (
  seq           INTEGER PRIMARY KEY AUTOINCREMENT,
  feed_url      TEXT NOT NULL,
  guid          TEXT NOT NULL,
  title         TEXT NOT NULL,
  link          TEXT,
  author        TEXT,
  published_at  INTEGER,
  excerpt       TEXT NOT NULL,
  html          TEXT,
  thumbnail     TEXT,
  first_seen_at INTEGER NOT NULL,
  UNIQUE (feed_url, guid)
);

CREATE TABLE poll_meta (
  key   TEXT PRIMARY KEY,
  value INTEGER NOT NULL
);

CREATE INDEX idx_polled_feeds_next_poll ON polled_feeds(next_poll_at);
CREATE INDEX idx_polled_items_feed_seq ON polled_items(feed_url, seq);
CREATE INDEX idx_polled_items_first_seen ON polled_items(first_seen_at);
