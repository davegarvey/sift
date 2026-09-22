CREATE TABLE upstream_origin_policy (
  origin_key        TEXT PRIMARY KEY,
  next_request_at   INTEGER NOT NULL DEFAULT 0,
  cooldown_until    INTEGER NOT NULL DEFAULT 0,
  cooldown_status   INTEGER,
  challenge_count   INTEGER NOT NULL DEFAULT 0,
  updated_at        INTEGER NOT NULL
);

CREATE INDEX idx_upstream_origin_policy_cleanup
  ON upstream_origin_policy(cooldown_until, next_request_at, updated_at);
