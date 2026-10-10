-- OAuth clients seen by the authorisation server. kind is 'registered'
-- (Dynamic Client Registration) or 'metadata' (Client ID Metadata Document,
-- where client_id is the document URL). redirect_uris is a JSON array.
-- expires_at is the metadata cache expiry and is NULL for registered clients.
CREATE TABLE IF NOT EXISTS oauth_clients (
  client_id     TEXT PRIMARY KEY,
  client_name   TEXT NOT NULL,
  redirect_uris TEXT NOT NULL,
  kind          TEXT NOT NULL,
  created_at    INTEGER NOT NULL,
  expires_at    INTEGER
);

-- Single-use connection IDs minted from Settings and bound to a sync key.
-- All times are epoch seconds. used_at is set when authorisation consumes it.
CREATE TABLE IF NOT EXISTS oauth_connections (
  connection_id TEXT PRIMARY KEY,
  sync_key      TEXT NOT NULL,
  created_at    INTEGER NOT NULL,
  expires_at    INTEGER NOT NULL,
  used_at       INTEGER
);

-- Pending authorisation requests. approval_code is the short code shown on
-- the consent page for approval from another device. decision is NULL while
-- pending, then 'approved' or 'denied', and sync_key is set once decided.
-- connection_id is the connection ID the request arrived with, if any.
CREATE TABLE IF NOT EXISTS oauth_requests (
  request_id     TEXT PRIMARY KEY,
  approval_code  TEXT NOT NULL UNIQUE,
  client_id      TEXT NOT NULL,
  redirect_uri   TEXT NOT NULL,
  code_challenge TEXT NOT NULL,
  scopes         TEXT NOT NULL,
  state          TEXT,
  resource       TEXT,
  connection_id  TEXT,
  decision       TEXT,
  sync_key       TEXT,
  created_at     INTEGER NOT NULL,
  expires_at     INTEGER NOT NULL
);

-- One-time authorisation codes, stored as SHA-256 hashes. Deleted on use.
CREATE TABLE IF NOT EXISTS oauth_codes (
  code_hash      TEXT PRIMARY KEY,
  client_id      TEXT NOT NULL,
  redirect_uri   TEXT NOT NULL,
  code_challenge TEXT NOT NULL,
  scopes         TEXT NOT NULL,
  resource       TEXT,
  sync_key       TEXT NOT NULL,
  created_at     INTEGER NOT NULL,
  expires_at     INTEGER NOT NULL
);

-- Token columns. origin is 'paired' (siftctl) or 'oauth'. scopes is a
-- space-separated subset of 'read write'. expires_at is the access token
-- expiry in epoch seconds (NULL for paired tokens, which do not expire).
-- An OAuth grant is one row: refresh rotates token_hash and refresh_hash in
-- place and keeps token_id and family_id. prev_refresh_hash holds the refresh
-- hash that was just replaced, so presenting it again is detected as reuse and
-- revokes the whole family. refresh_expires_at slides on every refresh.
ALTER TABLE tokens ADD COLUMN origin TEXT NOT NULL DEFAULT 'paired';
ALTER TABLE tokens ADD COLUMN client_id TEXT;
ALTER TABLE tokens ADD COLUMN client_name TEXT;
ALTER TABLE tokens ADD COLUMN scopes TEXT NOT NULL DEFAULT 'read write';
ALTER TABLE tokens ADD COLUMN refresh_hash TEXT;
ALTER TABLE tokens ADD COLUMN prev_refresh_hash TEXT;
ALTER TABLE tokens ADD COLUMN refresh_expires_at INTEGER;
ALTER TABLE tokens ADD COLUMN expires_at INTEGER;
ALTER TABLE tokens ADD COLUMN family_id TEXT;
-- User-chosen display name, trimmed, at most 64 characters, NULL when unset.
ALTER TABLE tokens ADD COLUMN label TEXT;

UPDATE tokens SET origin = 'paired', scopes = 'read write';

CREATE INDEX IF NOT EXISTS idx_oauth_connections_expires ON oauth_connections(expires_at);
CREATE INDEX IF NOT EXISTS idx_oauth_connections_sync_key ON oauth_connections(sync_key);
CREATE INDEX IF NOT EXISTS idx_oauth_requests_expires ON oauth_requests(expires_at);
CREATE INDEX IF NOT EXISTS idx_oauth_codes_expires ON oauth_codes(expires_at);
CREATE INDEX IF NOT EXISTS idx_oauth_codes_sync_key ON oauth_codes(sync_key);
CREATE INDEX IF NOT EXISTS idx_tokens_refresh_hash ON tokens(refresh_hash);
CREATE INDEX IF NOT EXISTS idx_tokens_prev_refresh_hash ON tokens(prev_refresh_hash);
CREATE INDEX IF NOT EXISTS idx_tokens_family_id ON tokens(family_id);
CREATE INDEX IF NOT EXISTS idx_tokens_refresh_expires_at ON tokens(refresh_expires_at);
