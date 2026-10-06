-- Look up live subscriptions by feed URL. Account deletion uses this to keep
-- polling state that another account still subscribes to.
CREATE INDEX IF NOT EXISTS idx_feeds_live_feed_url
  ON feeds(feed_url)
  WHERE deleted = 0 AND feed_url IS NOT NULL;
