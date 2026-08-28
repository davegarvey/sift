-- Durable aggregate reading statistics.
-- `ever_read` is lifetime state alongside current flags; it is never cleared
-- by an unread write or feed tombstone cleanup.
ALTER TABLE flags ADD COLUMN ever_read INTEGER NOT NULL DEFAULT 0;

CREATE TABLE feed_stats (
  sync_key   TEXT NOT NULL,
  feed_id    TEXT NOT NULL,
  total_seen INTEGER NOT NULL DEFAULT 0,
  read_once  INTEGER NOT NULL DEFAULT 0,
  feed_url   TEXT,
  title      TEXT,
  row_at     INTEGER NOT NULL,
  PRIMARY KEY (sync_key, feed_id)
);

CREATE INDEX idx_flags_ever_read ON flags(sync_key, ever_read, row_at);
CREATE INDEX idx_feed_stats_row_at ON feed_stats(sync_key, row_at);
