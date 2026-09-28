-- Rebuild feeds and flags in the feed_id-keyed shape the sync routes use.
--
-- Two shapes reach this migration:
--   * migrations-only databases still have the 0001 tables, keyed by
--     feed_url, with no feed_id, feed_url_at, html_url or html_url_at columns
--     and flags.feed_url instead of flags.feed_id;
--   * databases whose feeds and flags were recreated by the runtime bootstrap
--     (server/sync/schema.ts, stable feed IDs, #427) already have the target
--     columns, possibly in a different order.
--
-- SQL migrations cannot branch on the existing shape, so each shape-specific
-- column is read through a correlated subquery against the old table. SQLite
-- resolves the column name in the subquery's own FROM first: when the old
-- table has the column, its value is copied; when it does not, the name falls
-- through to the `absent` row, which supplies NULL. Rows without a feed_id
-- can only come from pre-#427 clients, cannot be addressed by current
-- clients, and are not copied (#427 dropped them for the same reason).

CREATE TABLE feeds_next (
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
);

INSERT INTO feeds_next (
  sync_key, feed_id, feed_url, feed_url_at, folder, folder_at, title, title_at,
  tags, tags_at, html_url, html_url_at, deleted, deleted_at, row_at
)
SELECT * FROM (
  SELECT
    old.sync_key,
    (SELECT feed_id     FROM feeds AS cur WHERE cur.rowid = old.rowid) AS feed_id,
    old.feed_url,
    (SELECT feed_url_at FROM feeds AS cur WHERE cur.rowid = old.rowid),
    old.folder,
    old.folder_at,
    old.title,
    old.title_at,
    old.tags,
    old.tags_at,
    (SELECT html_url    FROM feeds AS cur WHERE cur.rowid = old.rowid),
    (SELECT html_url_at FROM feeds AS cur WHERE cur.rowid = old.rowid),
    old.deleted,
    old.deleted_at,
    old.row_at
  FROM feeds AS old,
    (SELECT NULL AS feed_id, NULL AS feed_url_at, NULL AS html_url, NULL AS html_url_at) AS absent
)
WHERE feed_id IS NOT NULL;

DROP TABLE feeds;
ALTER TABLE feeds_next RENAME TO feeds;

CREATE TABLE flags_next (
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
);

INSERT INTO flags_next (
  sync_key, item_id, feed_id, read, read_at, starred, starred_at, ever_read, row_at
)
SELECT * FROM (
  SELECT
    old.sync_key,
    old.item_id,
    (SELECT feed_id FROM flags AS cur WHERE cur.rowid = old.rowid) AS feed_id,
    old.read,
    old.read_at,
    old.starred,
    old.starred_at,
    old.ever_read,
    old.row_at
  FROM flags AS old,
    (SELECT NULL AS feed_id) AS absent
)
WHERE feed_id IS NOT NULL;

DROP TABLE flags;
ALTER TABLE flags_next RENAME TO flags;

CREATE INDEX idx_feeds_row_at     ON feeds(sync_key, row_at);
CREATE INDEX idx_flags_row_at     ON flags(sync_key, row_at);
CREATE INDEX idx_flags_feed_id    ON flags(sync_key, feed_id);
CREATE INDEX idx_flags_ever_read  ON flags(sync_key, ever_read, row_at);
