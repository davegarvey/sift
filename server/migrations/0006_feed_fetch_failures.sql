CREATE TABLE feed_fetch_failures (
  feed_key    TEXT PRIMARY KEY,
  status      INTEGER NOT NULL,
  retry_at    INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL
);

CREATE INDEX idx_feed_fetch_failures_retry_at ON feed_fetch_failures(retry_at);
