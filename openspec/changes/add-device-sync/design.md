## Context

Sift is a browser-first RSS reader. All data lives in IndexedDB. The Worker is a stateless proxy that pipes `/feed`, `/article`, and `/img` requests to upstreams without ever logging the URL. There is no user identity, no auth, and no persistent server state.

The user wants to read on phone and desktop interchangeably. The minimum useful sync is: "carry over my subscriptions and read state." Article content does not need to be in the cloud — each device fetches it from the source through the existing proxy, exactly as today.

The Worker already deploys to Cloudflare. D1 is the natural fit: a serverless SQLite database that costs nothing at personal-use scale and integrates with the existing `wrangler deploy` workflow.

## Goals / Non-Goals

**Goals:**

- Sync feed subscriptions (URL + folder) bidirectionally.
- Sync per-item read and starred flags bidirectionally.
- Multi-tenant on a single D1 database, partitioned by sync key.
- Zero-friction pairing via three complementary flows: QR (for camera-equipped targets, v2), 8-character server-generated OTP (for keyboard-only targets, no camera), and direct paste (always available).
- No device-type detection. All three flows are always presented.
- Survive offline use: queue local changes, push when back online.
- Conflict resolution: per-field, server-timestamp newer-wins, with monotonic time (not `Date.now()`).
- User creation is explicit (`/sync/register`); push and pull reject unknown keys.
- In-Worker rate limiting keeps the deploy on the Workers Free plan; no Cloudflare WAF required.
- Per-user row caps bound D1 storage per user.
- Server never logs the sync key, the feed URL, or any other user-identifying data.
- Sync is opt-in: existing users see no UI change until they enable it.

**Non-Goals:**

- Server-side feed fetching. Each device fetches its own feeds through the proxy. Sync is "carry over state," not "make the server your feed reader."
- Article HTML, thumbnails, extracted content. Devices fetch these independently.
- Syncing per-device settings (theme, MCP toggle, sidebar state, river scope). These stay local.
- End-to-end encryption. The server sees feed URLs and read flags; this is an RSS reader, not a secure messenger.
- Real-time push (websockets, SSE). Polling on focus + push on change is "good enough" for the use case.
- Account recovery, password reset, or any user-management surface. Regenerate the key; the old key's data on the server is orphaned.
- Multi-user per device. The sync key is per-user, not per-device — both of *my* devices share the same key.
- Server-side detection of client device type. The unified pairing modal exposes all three flows; the user picks the one that fits their situation.

## Decisions

### 1. Storage: D1 on the existing Worker

D1 is the simplest path because the Worker already deploys to Cloudflare. No new runtime, no external service, no new auth surface. D1's free tier (5M rows read/day, 100K written/day, 5GB storage) is enormous for a personal reader.

For non-Workers deployments (Node, Bun, Docker), D1 is not available. The sync routes are a no-op when the D1 binding is absent — sync is a Workers-only feature. The Node/Bun adapters do not register the sync routes, and the browser detects this and hides the Sync UI. Self-hosters lose device sync; their proxy and local IDB continue to work.

### 2. Auth: sync key as bearer token

A 16-byte random value, base64url-encoded → 22 characters. The key *is* the user identity. No account creation, no email, no password.

- Generated client-side when the user enables sync (`crypto.getRandomValues(new Uint8Array(16))`).
- Stored in IDB meta store. Persists across browser restarts.
- Sent on every sync request as `X-Sync-Key: <key>`.
- Server middleware: extract header, validate format (22 base64url chars), look up `users` row, reject with 401 if missing.
- **User creation is explicit**: `POST /sync/register` is the only path that inserts a `users` row. Push and pull reject unknown keys. This avoids the lazy-user-creation D1 DoS vector.

**Pairing UX (unified, no device detection)**:

A single "Pair another device" button opens a modal that always shows:

- A **QR code** (compact, scannable from a phone camera).
- An **8-character server-generated OTP** (typed on the target, server-mediated key transfer, 5-minute TTL).
- The **sync key as a copyable string** (paste directly on the target).

And below, an input field for the target to paste a code or sync key. The user picks the affordance that fits their situation; the source device doesn't try to guess.

**Threat model**:
- Casual snooping: blocked by HTTPS (Workers require it).
- Brute force: 128 bits = infeasible.
- Server breach: keys visible but useless for cross-user access; data is opaque RSS metadata.
- Lost or stolen device: regenerate on a trusted device, pair the new one. Old key's data is orphaned (a few KB).
- **Public-deployment DoS**: rate-limited per-IP and per-key, with per-user row caps.

### 3. Schema

```sql
-- One row per sync key. Created only by /sync/register.
CREATE TABLE users (
  sync_key TEXT PRIMARY KEY,
  created_at INTEGER NOT NULL
);

-- Feed subscriptions with per-field timestamps for PATCH semantics.
CREATE TABLE feeds (
  sync_key TEXT NOT NULL,
  feed_url TEXT NOT NULL,
  folder TEXT,            -- JSON array; null = root
  folder_at INTEGER,      -- monotonic; null if folder never set
  title TEXT,
  title_at INTEGER,
  deleted INTEGER NOT NULL DEFAULT 0,
  deleted_at INTEGER,
  row_at INTEGER NOT NULL, -- max(field_at); used for pull ordering
  PRIMARY KEY (sync_key, feed_url)
);

-- Item flags with per-field timestamps. feed_url is denormalized from item_id
-- so the server can answer "all flags for feed X" cheaply for unsubscribe.
CREATE TABLE flags (
  sync_key TEXT NOT NULL,
  item_id TEXT NOT NULL,        -- format: "encodeURIComponent(feedUrl)::guid"
  feed_url TEXT NOT NULL,
  read INTEGER,                 -- 1, 0, or NULL (no opinion)
  read_at INTEGER,
  starred INTEGER,
  starred_at INTEGER,
  row_at INTEGER NOT NULL,
  PRIMARY KEY (sync_key, item_id)
);

-- Short-lived pairing codes for the OTP flow.
CREATE TABLE pairing_codes (
  code TEXT PRIMARY KEY,        -- 6 digits
  sync_key TEXT NOT NULL,
  expires_at INTEGER NOT NULL
);

-- Monotonic counter. Updated atomically on every server-side timestamp
-- assignment. Survives clock regression.
CREATE TABLE counters (
  name TEXT PRIMARY KEY,
  value INTEGER NOT NULL
);

-- Rate limit counters. Scoped per route + per principal.
CREATE TABLE rate_limits (
  scope TEXT NOT NULL,          -- e.g., "register:1.2.3.4", "push:abc...xyz"
  window_start INTEGER NOT NULL, -- epoch seconds, aligned to window
  count INTEGER NOT NULL,
  PRIMARY KEY (scope, window_start)
);

CREATE INDEX idx_feeds_row_at ON feeds(sync_key, row_at);
CREATE INDEX idx_flags_row_at ON flags(sync_key, row_at);
CREATE INDEX idx_flags_feed_url ON flags(sync_key, feed_url);
CREATE INDEX idx_pairing_expires ON pairing_codes(expires_at);
CREATE INDEX idx_rate_limits_window ON rate_limits(window_start);

INSERT INTO counters (name, value) VALUES ('server_time', 0);
```

**Item-ID encoding**: client constructs `itemId = encodeURIComponent(feedUrl) + '::' + guid`. Server stores as a single string. On apply, split at the *last* `::` and `decodeURIComponent` the feed URL.

**Tombstones**: an unsubscribed feed remains in the `feeds` table with `deleted=1, deleted_at=T`. A scheduled Worker cron (daily) deletes rows where `deleted=1 AND deleted_at < now - 30 days`. Within the tombstone window, a device that re-subscribes to the same URL just sets `deleted=0, deleted_at=null` (or updates `deleted_at` to a more recent timestamp; the field-stamped PATCH handles this).

### 4. Monotonic time

`Date.now()` is not monotonic — NTP slew, container pauses, Cloudflare infrastructure migrations can all cause wall-clock regression. A clock jump backward breaks the `since=X` pull model (rows stamped at the higher time are skipped on the next pull).

Instead, every server-side timestamp comes from a D1 counter:

```sql
UPDATE counters SET value = value + 1 WHERE name = 'server_time' RETURNING value;
```

The counter is a single row in a small table, atomic in SQLite via the implicit write lock. For a personal RSS reader, contention is negligible (a few writes per second at most).

The current value is included in pull responses as `serverTime`. Clients use it as their `lastSyncAt` for the next pull.

### 5. Sync protocol

**Register** (one-time per user, creates the `users` row):

```
POST /sync/register
X-Sync-Key: <key>
→ 204 No Content
→ 401 if X-Sync-Key missing or malformed
→ 429 if rate-limited (per-IP)
```

**OTP issue** (one-way; source device → server):

```
POST /sync/otp
X-Sync-Key: <key>
→ 200 { "code": "a3k9z2", "expiresAt": 1720812349999 }
→ 401 if X-Sync-Key missing, malformed, or unknown
→ 429 if rate-limited (per-sync-key)
```

The server generates the code (8 characters, lowercase alphanumeric from the 31-char unambiguous alphabet `[a-hj-km-np-z2-9]`, no `0`/`o`/`1`/`l`/`i`), inserts `(code, sync_key, expires_at)` into `pairing_codes`, and returns it.

**Why server-generated**: a client-generated code allows a colliding `INSERT OR REPLACE` to overwrite a victim's `(code → sync_key)` mapping, enabling cross-user sync-key theft. Server generation guarantees uniqueness without an explicit collision check and uses the full 36⁸ ≈ 2.8T code space.

**Code format**: 8 characters from `[a-hj-km-np-z2-9]` (31 unambiguous characters; the alphabet excludes `0`/`1`/`l`/`i`/`o` to avoid typing ambiguity). 31⁸ ≈ 8.5 × 10¹¹ combinations, well beyond brute force given the rate limit.

**Display**: the source device renders the code in a monospace font with letter-spacing for readability.

**Source confirmation**: the source device does not need a server-mediated confirmation. On the source's next pull, the target's first push is visible (e.g., the target's existing flags), and the source shows "Paired with another device" in the modal until then. The 5-minute TTL bounds the wait.

**OTP redeem** (one-way; target device ← server):

```
POST /sync/redeem
Content-Type: application/json
{ "code": "a3k9z2" }
→ 200 { "syncKey": "..." }
→ 400 if code is malformed (not 8 chars from the allowed alphabet)
→ 404 if code is unknown or expired
→ 429 if rate-limited (per-IP, brute-force protection)
```

The server deletes the code on successful redemption (one-time use).

**Push** (PATCH semantics):

```
POST /sync/push
X-Sync-Key: <key>
Content-Type: application/json

{
  "feeds": [
    {
      "feedUrl": "https://example.com/feed.xml",
      "folder":     { "value": ["Tech"], "at": 1720812345678 },
      "title":      { "value": "Example Feed", "at": 1720812345679 },
      "deleted":    { "value": 0, "at": 1720812350000 }
    }
  ],
  "flags": [
    {
      "itemId": "https%3A%2F%2Fexample.com%2Ffeed.xml::guid-1",
      "feedUrl": "https://example.com/feed.xml",
      "read":    { "value": 1, "at": 1720812345678 }
    }
  ]
}
```

For each field in the payload, the server runs a two-statement upsert. The first statement inserts a new row if none exists; the second applies the per-field PATCH with timestamp comparison.

```sql
-- Step 1: insert a new row if it does not exist (no-op if it does).
-- All other fields default to NULL; the per-field PATCH in step 2 fills them in.
INSERT OR IGNORE INTO feeds (sync_key, feed_url, row_at) VALUES (?, ?, 0);

-- Step 2: per-field PATCH. For each field in the payload, the value is
-- updated only if the payload's `at` is greater than the existing field's `at`,
-- or if the existing field has no timestamp yet (NULL).
UPDATE feeds SET
  folder     = CASE WHEN feeds.folder_at  IS NULL OR :folder_at  > feeds.folder_at  THEN :folder  ELSE feeds.folder  END,
  folder_at  = CASE WHEN feeds.folder_at  IS NULL OR :folder_at  > feeds.folder_at  THEN :folder_at ELSE feeds.folder_at END,
  title      = CASE WHEN feeds.title_at   IS NULL OR :title_at   > feeds.title_at   THEN :title   ELSE feeds.title   END,
  title_at   = CASE WHEN feeds.title_at   IS NULL OR :title_at   > feeds.title_at   THEN :title_at  ELSE feeds.title_at  END,
  deleted    = CASE WHEN feeds.deleted_at IS NULL OR :deleted_at > feeds.deleted_at THEN :deleted ELSE feeds.deleted END,
  deleted_at = CASE WHEN feeds.deleted_at IS NULL OR :deleted_at > feeds.deleted_at THEN :deleted_at ELSE feeds.deleted_at END,
  row_at     = MAX(COALESCE(feeds.folder_at, 0), COALESCE(feeds.title_at, 0), COALESCE(feeds.deleted_at, 0), :folder_at, :title_at, :deleted_at)
WHERE sync_key = :sync_key AND feed_url = :feed_url;
```

**Tie-breaking**: when `:at` equals the existing field's `at`, the CASE evaluates to the existing value (strict `>` comparison). The first-writer wins on equal timestamps; subsequent ties keep the existing value. This avoids two devices fighting forever on simultaneous edits.

**Tombstone re-subscribe**: any write to a tombstoned row (`deleted=1`) first clears the tombstone, then applies the PATCH. Concretely, the server prepends a tombstone-clear to step 2:

```sql
-- (only if the existing row is tombstoned)
UPDATE feeds SET deleted = 0, deleted_at = NULL
WHERE sync_key = :sync_key AND feed_url = :feed_url AND deleted = 1;
```

This way, a client that pushes only `folder` and `title` to a re-subscribed feed still lifts the server-side tombstone. The client's explicit `deleted: 0` push is the primary mechanism; this server-side clear is the safety net.

**Field-at validation**: the server rejects any push payload where a field's `at` is not a positive integer (NULL is rejected; 0 is allowed only for fields with no other writes yet). This is part of the 400 validation in the push handler.

**Server-side `feed_url` validation**: the server derives `feed_url` from `item_id` (split at the last `::`, `decodeURIComponent` the prefix). The client-supplied `feed_url` field in the flags payload is verified to match the derived value; a mismatch returns 400. This prevents a buggy or malicious client from storing flags under the wrong feed URL.

**Wire format for `folder`**:
- A JSON array of strings: `["Tech", "RSS"]` → root-relative path `Tech/RSS` in OPML.
- `null` → root (no folder).
- `[]` → root (equivalent to `null`; the server normalizes to NULL on storage).
- The push payload uses `null` to mean "no folder" and `[]` to mean "root-level" — both normalize to NULL on the server.

The push is atomic per-row: each row's update is two statements. The whole request is not transactional across rows (D1 batch insert within a single request is fine, but cross-row consistency within one push is "best effort" — which is acceptable for RSS). The whole push runs inside a single `db.batch()` call to minimize round-trips.

**Per-user row cap check**: the cap is checked once per push (not per-row), as a single `SELECT COUNT(*)` query, before the batch. If the count plus the new row count exceeds the cap, the push returns 413 and the batch is not sent. The cap check and the batch run in the same D1 request to keep them atomic with respect to the batch's effects.

**Pull** (response shape):

```
GET /sync/pull?since=<monotonic_ms>
X-Sync-Key: <key>
→ 200 {
    "serverTime": 1720812349999,
    "feeds": [
      { "feedUrl": "...", "folder": [...], "folderAt": ..., "title": "...", "titleAt": ..., "deleted": 0, "deletedAt": ..., "rowAt": ... }
    ],
    "flags": [
      { "itemId": "...", "feedUrl": "...", "read": 1, "readAt": ..., "starred": 0, "starredAt": ..., "rowAt": ... }
    ]
  }
→ 401 if X-Sync-Key missing, malformed, or unknown
→ 429 if rate-limited
```

The server returns only rows with `row_at > since`. The client updates `lastSyncAt = max(currentLastSyncAt, serverTime)`.

### 6. Rate limiting (in-Worker, no WAF)

Cloudflare WAF rate limiting is a paid feature (only 1 rule on Free). To keep the deploy free, rate limiting is implemented in the Worker code, using D1 as the counter store. The cost is one D1 read + one D1 write per request (amortized; we read the current window, conditionally increment).

**Algorithm (fixed window)** — the upsert uses `INSERT ... ON CONFLICT DO UPDATE` so the increment references the current row, not a deleted one (an `INSERT OR REPLACE` would first `DELETE` the existing row, making `count + 1` evaluate to `NULL`):

```
window = floor(now_seconds / WINDOW_SECONDS) * WINDOW_SECONDS
key    = `${route}:${principal}`   // e.g., "register:1.2.3.4"
limit  = LIMIT[route]

-- Read current count (read-only; do not modify the row)
current = SELECT count FROM rate_limits WHERE scope = ? AND window_start = ?
if (current >= limit) {
  retry_after = window_start + WINDOW_SECONDS - now_seconds
  return 429 with Retry-After: retry_after
}

-- Atomically increment via upsert
INSERT INTO rate_limits (scope, window_start, count) VALUES (?, ?, 1)
  ON CONFLICT (scope, window_start) DO UPDATE SET count = count + 1
```

**Limits (defaults; tunable via env)**:

| Route | Principal | Window | Limit |
|-------|-----------|--------|-------|
| `POST /sync/register` | client IP | 1 hour | 10 |
| `POST /sync/register` | global | 1 day | 1000 |
| `POST /sync/otp` | sync key | 1 hour | 20 |
| `POST /sync/redeem` | client IP | 1 minute | 10 |
| `POST /sync/push` | sync key | 1 minute | 60 |
| `GET /sync/pull` | sync key | 1 minute | 60 |

The `register:global` scope is a single row in `rate_limits` shared by all callers. The limit (1000/day) caps the damage from distributed registration attacks; once exhausted, `/sync/register` returns 503 (not 429) to signal "service at capacity, try again tomorrow."

A 429 response is `Retry-After: <seconds_until_window_end>`. The client respects `Retry-After` and does not retry until then.

**Garbage collection**: rows older than the largest window are deleted by the same daily cron that handles tombstones. The D1 table stays bounded. The daily cron also cleans up `pairing_codes` rows whose `expires_at < now - 1 day` (they're already invalid; the table stays bounded).

### 7. Per-user row caps

D1 storage is bounded; an authenticated user (or a stolen key) can still fill their slice. The push handler enforces:

- Max 10,000 feeds per user.
- Max 1,000,000 flags per user.

Push returns 413 above the cap. The client surfaces the error in the Settings UI ("Sync storage limit reached") and stops pushing until the user regenerates the key (which orphans the data and starts fresh).

### 8. First-time setup merge

When a device enables sync for the first time (or re-enables it with an existing key), the local IDB may already contain data. The merge must preserve both local and server state, with the server's per-field newer-timestamp winning.

**Order**:

1. **Snapshot local state** — read all feeds and flags into memory.
2. **Push snapshot** — for each row, push only the fields that are present locally (the PATCH semantics mean the server compares per-field timestamps). Local "newer" wins on push.
3. **Pull `since=0`** — fetch the full server state.
4. **Merge in memory** — for each server row, apply its fields to the in-memory local snapshot only if the server's per-field timestamp is newer. The result is a unified view.
5. **Apply merged view to local IDB** — write the merged rows to the local stores.
6. **Re-push the merged view** — server may still have older state in fields we didn't push in step 2; re-push the merged view to ensure server convergence. Mostly a no-op due to PATCH idempotency; the value is safety net for D1 eventual consistency.

**Interaction with the dirty set during a mid-session enable**: if the user enables sync and then takes sync-relevant actions (mark read, star, subscribe) before the first-time merge completes, those actions append to the dirty set normally. The first-time merge's step-2 push contains only the snapshot (the dirty entries were not in the local state at snapshot time), and step-6 re-push contains the merged view (also not the dirty entries). The dirty entries are pushed separately by the normal debounced flusher after the merge completes. This may temporarily duplicate data between the merge's push and the dirty-set push, but PATCH semantics make the duplication idempotent (the same field is sent twice with the same timestamp, the server keeps the existing value on a tie).

**Why re-push at step 6**: pull returns whatever the server has. If we didn't push a field (because it was missing locally), the server keeps its own value. Pull tells us what the server has; we adopt it if newer. But the server hasn't been told about fields the local snapshot had that were newer. The re-push propagates the merged state up.

**Empty dirty set after merge**: the client clears its dirty set only on successful push, so step 6's push naturally clears it.

### 9. Client architecture

**Dirty set**: an in-memory array of `{kind, ...payload}` records for local changes that haven't been pushed yet, persisted to the IDB meta store under `sync_dirty` (JSON value) on a debounced cadence. Kinds: `feed-upsert`, `feed-delete`, `flag-update`.

**Why in-memory**: persisting on every `enqueue*` call would re-serialize the entire list on each user action. For a user marking 10K items as read in one session, that's 10K IDB writes. Keeping the dirty set in memory and persisting on debounce / app pause / beforeunload avoids this.

**Bounded growth**: the in-memory array is bounded by the 1MB push payload cap. If the dirty set would exceed 500 entries (the chunk size), the push is triggered immediately rather than waiting for the debounce. If the user goes offline, the dirty set accumulates up to the soft cap; beyond that, `enqueue*` returns a warning to the UI ("Sync paused — too many pending changes") and stops queuing until the next successful push.

**Push path**:
- User action (subscribe, unsubscribe, mark read, star) → local IDB write → append to `sync_dirty` → debounce 1s → flush.
- Debounce coalesces rapid changes (e.g., bulk mark-read) into a single push.
- The flusher reads the dirty set, batches it into chunks of 500, and pushes each chunk. On 413 (oversize), it splits the chunk in half and retries. On 429, it respects `Retry-After`. On 5xx or network error, it backs off (1s, 2s, 5s, 10s, max 60s) and keeps the dirty set intact.
- The dirty set is cleared only on a 2xx response for that entry.

**Pull path**:
- On app boot: if `syncKey` is set, pull `since=lastSyncAt`. Apply each row to local IDB. Update `lastSyncAt = max(currentLastSyncAt, serverTime)`.
- On `document.visibilitychange` (when becoming visible): pull if the last successful pull was >30s ago.
- On `online` event: pull.
- On Settings → "Sync now" click: pull.

**Apply rules**:
- `feeds`: for each remote row, upsert into local `feeds` store. The local fields are only overwritten if the remote timestamp is newer. The tombstone-apply rule is: if the remote row has `deleted=1` AND the remote `deleted_at` is newer than the local `lastFetched` for the same URL, call `unsubscribeFeed(feedUrl)`. If the local `lastFetched` is newer than the remote `deleted_at`, the local is fresher and the tombstone is ignored (the local may have re-fetched or re-subscribed after the remote delete). If the local does not have the feed at all, no action is taken.
- `flags`: for each remote row, upsert into the `itemFlags` store. Update `items.read`/`items.starred` only for items that exist locally. Flags for unknown items are stored; the value applies when the item appears (after a feed refresh).

**Toggle off** clears the local sync key AND the dirty set. Without clearing the dirty set, a future re-enable (with a regenerated key) would push the old dirty entries to the new key, polluting the new user.

**Item-ID encoding on apply**: split at the *last* `::` (in case `feedUrl` contains `::`), `decodeURIComponent` the prefix to recover the feed URL, treat the suffix as the guid.

### 10. UI

**Settings → Sync section** (new; conditionally rendered when `isSyncAvailable()` is true):

- **Sync toggle**: off by default. Toggling on (no key): modal opens, generates a key, shows pairing UI. Toggling on (key already set): just enables (this is the re-enable path).
- **Sync-on state**:
  - **Pairing code (primary in v1)** — generated by the server, 8 characters, lowercase alphanumeric. The source clicks "Issue pairing code" once, the code is fetched from `/sync/otp`, displayed in a monospace font with letter-spacing, and a 5-minute countdown is shown. The target types the code into its own Settings → Sync → Enable → "I have a pairing code" field. The source shows "Waiting for another device to pair…" until it sees the target's first push.
  - **Sync key (always available)** — the 22-character sync key as a monospace string with a copy button. For users who want to copy/paste the key directly without the OTP roundtrip.
  - **QR code (secondary in v1)** — generated by `qrcode-generator` library, error correction M, version 2 or 3 for 22-byte keys. Displayed for v2 camera scanning, but the modal notes "Scan this from another device's camera (coming in v2)".
  - "Last synced: 3m ago" (relative time, updates every 30s while drawer is open).
  - "Sync now" button (manual pull trigger).
  - "Regenerate key" button (with confirm dialog: "Your other devices will stop syncing. Server data is kept until you generate a new key. Continue?").
- **Sync-off state**:
  - "Enable sync" button — opens pairing modal in the *receiving* state (paste / type a code).
  - Description: "Sync copies your subscriptions and read state between devices using a server-stored key. There is no account; if you lose the key, server data is not recoverable."
- **Pairing modal** (the unified UI — no device detection):
  - When opened from a device that already has sync enabled: shows QR + OTP + key, plus an input field for the target to paste a code or key.
  - When opened from a fresh device: shows the input field first, with a "Generate a new sync key" link below for users who want to start fresh.
  - QR is the most prominent element on wide screens; on narrow screens it stacks above the code/paste UI.

**Graceful degradation** (Node/Bun self-host):
- `GET /sync/capabilities` returns 404 (route not registered) → the entire Sync section is hidden.
- Capabilities check is per page load (not cached), so a server that was down at boot but is up later will be discovered on the next page reload.

### 11. Security details

- **No logging of sync keys, feed URLs, or PII**: extend the `assertNoUrlLog` pattern (which lives in `server/fetch.ts`). Move it (and the new sync helpers) to `server/log.ts` for consistency, and call them in the sync auth middleware and route handlers. The no-op pattern is a code comment, not an enforcement — but the helpers make the intent visible in code review and lint-friendly (`no-console` inside `server/sync.ts` is enforced by an eslint override).
- **HTTPS only**: Workers enforce it.
- **No CORS on `/sync/*`**: the Worker does NOT set `Access-Control-Allow-Origin` on any sync route, and rejects preflight `OPTIONS` with 403. Sync is same-origin only. Without CORS, a malicious site cannot read responses or include the `X-Sync-Key` header (the key is in IDB, not accessible cross-origin).
- **Bearer-token format validation**: the auth middleware rejects `X-Sync-Key` values that are not exactly 22 base64url characters *before* hitting the database. Prevents header-injection-shaped bugs and accidental row pre-allocation.
- **Per-IP rate limit on `/sync/register`** (10/hour): prevents random-key user-creation flooding.
- **Global registration cap**: a hard cap on the total number of `users` rows, checked on every register. The cap is a small number (e.g., 100K) chosen so that even at cap the table is <10MB. Once the cap is reached, `/sync/register` returns 503. This bounds the damage from distributed registration attacks (where the per-IP limit is evaded by using many IPs).
- **Per-sync-key rate limit on `/sync/push` and `/sync/pull`** (60/min): prevents a single key from filling D1.
- **Per-IP rate limit on `/sync/redeem`** (10/min): prevents 8-character code brute force. 8 chars from a 30-char alphabet = 6.5 × 10¹¹ combinations, but 10/min × ~5 windows until the code expires makes brute force infeasible (would need ~1.3 × 10¹⁰ distinct IPs per code).
- **Stolen device recovery**: no server-side revocation. The only remediation is to regenerate the key on a trusted device and pair the new one. The old key's data on the server is orphaned (a few KB of flags and feed URLs).
- **CSRF**: not applicable — no cookies, no browser auto-credentials, no state-changing GETs.

### 12. What does *not* sync

Confirmed out of scope for v1:
- Article HTML, thumbnails, extracted content — devices fetch independently.
- Per-device settings (theme, high contrast, MCP toggle, sidebar collapsed, river scope, read filter).
- Feed-fetching metadata (ETag, Last-Modified, learned intervals).
- Last opened article, focused index, modal state.
- The OPML import/export is a manual portability path, not a sync mechanism.

## Risks / Trade-offs

- **D1 is Workers-only**: Node/Bun self-hosters lose device sync. Mitigation: sync routes are conditionally registered; UI hides the section when capabilities are absent. Documented in the README.
- **D1 eventual consistency**: a push from device A might be invisible to device B for 1-2 seconds. Acceptable for RSS. If users report issues, future work: use Durable Objects for strong consistency.
- **No end-to-end encryption**: the server sees feed URLs and read state. This is a deliberate trade-off.
- **Key loss / no recovery**: regenerating a key orphans the old data on the server (a few KB). The user can keep using the new key; the old data is just dead weight. The Settings UI prompts the user to back up the key (copy to a password manager) on first display.
- **First-device-setup pull may be large**: a freshly paired device with empty local state pulls all server data. For 100K flags, this is ~5MB. Acceptable on a one-time basis; not paginated in v1. Future work: paginate if real users hit this.
- **Offline support is "good enough"**: changes queue in IDB and push on next opportunity. No background sync (no Service Worker Background Sync API in v1).
- **Per-field PATCH complexity**: the protocol is more complex than full-row PUT (each field has its own `at`). The benefit is no stale-write clobbering. Worth the complexity.
- **Per-user row caps are aggressive**: 1M flags is large but bounded. A user who legitimately hits the cap is reading very heavily; regenerating the key is a one-click recovery.
- **OTP brute-force surface**: 8 chars from a 31-char unambiguous alphabet = 8.5 × 10¹¹ combinations. With 10/min rate limit and 5-min code TTL, an attacker can try at most 50 codes per code lifetime per IP. 8.5 × 10¹¹ / 50 ≈ 1.7 × 10¹⁰ IPs needed to brute force one code. Infeasible.
- **QR encoder quality**: we use a vetted library (`qrcode-generator`) instead of writing our own. Trade-off is ~5KB bundle size, but the library is well-tested across edge cases. A real decode test (with `jsQR`) is included in the test suite.
- **Camera-based QR scanning is not in v1**: the receiving device types the code or pastes the key. Camera scanning can be added in v2 using `BarcodeDetector` (built-in where available) or `jsQR` (fallback).
- **D1 per-row UPDATE cost**: each PATCH row in a push is a separate UPDATE. For 500 rows in a push, that's 500 round-trips to D1. D1's batch API helps, but per-statement latency is still a factor. For v1 this is acceptable. Future: use D1's batch / `db.batch()` API.
- **Last-writer-wins can lose user intent**: with per-field PATCH, this is much rarer than full-row PUT, but still possible. E.g., device A marks read=1 then deletes the item locally; device B re-adds the item with read=0; the fields are independent. Future work: explicit "force overwrite" semantics.

## Migration Plan

- New D1 binding is additive; existing users see no change.
- No data migration on the browser. Sync starts from the current local state on first enable; the first-time setup merge preserves both local and server state.
- `wrangler d1 migrations create` produces `server/migrations/0001_sync.sql`; applied via `wrangler d1 migrations apply` before first deploy.
- `wrangler.toml` adds a `[triggers]` cron entry for the daily tombstone + rate-limit GC.
- Rollout: deploy the Worker with the D1 binding; existing users without sync enabled see no UI change. Users opt in via Settings.
- Rollback: removing the D1 binding and sync routes from `handle.ts` reverts to the pre-sync Worker. Existing client builds (already with sync UI) will see the Sync section hidden.

## Open Questions

- **Camera-based QR scanning**: not in v1. v2 will use `BarcodeDetector` where available, `jsQR` as fallback.
- **Conflict UI**: if a flag is overwritten, do we surface it? v1: no, per-field LWW is silent. Future: optional "undo" toast.
- **Sync health**: surface "Last sync failed" in the UI if a push fails? v1: silent retry. Future: status indicator.
- **Soft delete vs hard delete on toggle off**: v1 hard-clears the local sync key AND the dirty set. Soft delete (mark as inactive, allow re-enable with same key) could be added later.
- **PII disclosure in UI**: the Settings panel's sync description mentions the server-side data. A future enhancement could add a "What data is stored?" link with the full list.
- **Schema versioning on the wire**: v1 ships with a single schema. Future schema changes must be additive (new fields, no renamed or removed fields) for cross-version compatibility. The PATCH semantics make this natural.

## Known Limitations (Accepted for v1)

- **Dirty set loss window on hard tab close**: the in-memory dirty set is persisted on debounce (1s), `beforeunload`, and `visibilitychange`. Mobile browsers (notably iOS Safari) and tab kills may not fire `beforeunload`. The worst-case loss is 1s of unsynced user actions. Acceptable for v1 of a personal reader; mitigations (shorter debounce, incremental IDB writes) are noted in `tasks.md` for v2.
- **30-day tombstone window for offline devices**: tombstones are deleted by the cron 30 days after creation. A device that does not pull for 30+ days will miss an unsubscribe that happened on another device. The user notices when they next open the app: the feed is still locally subscribed, but the server has no record of it. Mitigation: the user can re-subscribe (which clears the missing tombstone on the server) or manually unsubscribe. Documented in the Settings UI's sync description.
- **Toggle-off is destructive**: disabling sync clears the local key, dirty set, and `lastSyncAt`. Re-enabling with the same key triggers a full first-time merge, which pushes all local state to the server. Users debugging by toggling off/on will see their local state re-uploaded. Acceptable trade-off: the alternative (preserve `lastSyncAt` on toggle-off) hides bugs in the merge logic.
- **First-time merge step 6 (re-push) is mostly a no-op**: due to PATCH idempotency, the re-push rarely changes server state. Kept as a safety net for D1 eventual consistency and clock skew on the in-memory timestamps.
