-- Agent tokens for AI agent access (scoped, revocable credentials bound to a sync key).
-- Tokens are 23-character `t`-prefixed credentials; only their SHA-256 hash is stored.

-- Distinguish agent pairing codes from device pairing codes in the shared table.
ALTER TABLE pairing_codes ADD COLUMN kind TEXT NOT NULL DEFAULT 'device';

CREATE TABLE tokens (
  token_id         TEXT PRIMARY KEY,
  token_hash       TEXT NOT NULL UNIQUE,
  sync_key         TEXT NOT NULL,
  scope            TEXT NOT NULL DEFAULT 'rw',
  fingerprint      TEXT NOT NULL,
  created_at       INTEGER NOT NULL,
  last_seen_at     INTEGER,
  last_seen_minute INTEGER
);

CREATE INDEX idx_tokens_sync_key ON tokens(sync_key);
CREATE INDEX idx_pairing_codes_kind ON pairing_codes(kind);
