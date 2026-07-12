## 1. Schema and bindings

- [x] 1.1 Create `server/migrations/0001_sync.sql` with the `users`, `feeds`, `flags`, `pairing_codes`, `counters`, `rate_limits` tables and indexes (per-field timestamp columns on `feeds` and `flags`)
- [x] 1.2 Add `[[d1_databases]]` binding to `wrangler.toml` (`database_name = "sift-sync"`, `database_id` placeholder, `migrations_dir = "server/migrations"`)
- [x] 1.3 Add `[triggers] crons = ["0 3 * * *"]` to `wrangler.toml` for the daily tombstone + rate-limit + pairing-codes GC
- [x] 1.4 Document the `wrangler d1 migrations apply` step in `server/migrations/README.md`
- [x] 1.5 Document the dev workflow in `server/migrations/README.md`: `wrangler d1 execute sift-sync --local --file=./server/migrations/0001_sync.sql` before `npm run dev`

## 2. Server: rate limiter and monotonic time

- [x] 2.1 Move `assertNoUrlLog` from `server/fetch.ts` to `server/log.ts`; add `assertNoKeyLog()` and `assertNoUserDataLog()` no-op helpers in the same file; call them in the sync auth middleware and route handlers
- [x] 2.2 Create `server/sync/ratelimit.ts` with `checkRateLimit(db, scope, windowSeconds, limit) -> { ok, retryAfter }`; uses D1 `rate_limits` table; fixed-window algorithm; **upserts via `INSERT ... ON CONFLICT DO UPDATE SET count = count + 1`** (NOT `INSERT OR REPLACE` — that would delete-then-insert and make `count + 1` evaluate to `NULL`)
- [x] 2.3 Add a global registration rate limit: scope `register:global`, limit 1000/day, returns 503 (not 429) when exceeded
- [x] 2.4 Create `server/sync/monotonic.ts` with `nextMonotonicTime(db) -> number` that runs `UPDATE counters SET value = value + 1 WHERE name = 'server_time' RETURNING value` atomically
- [x] 2.5 Bootstrap `counters` row on first call: `INSERT OR IGNORE INTO counters (name, value) VALUES ('server_time', 0)`

## 3. Server: bearer-token auth middleware

- [x] 3.1 Create `server/sync/auth.ts` with `requireSyncKey(c) -> { syncKey, user } | 401`:
  - Extracts `X-Sync-Key` header
  - Validates format: exactly 22 base64url chars (regex)
  - Looks up `users` row; 401 if missing
  - Calls `assertNoKeyLog(syncKey)` before any logging
  - Returns 401 (not 403) on any failure to avoid signaling "key format vs key value"
- [x] 3.2 Add a `KEY_FORMAT_RE = /^[A-Za-z0-9_-]{22}$/` constant
- [x] 3.3 Add a server-side lint override in `eslint.config.js` to forbid `console.*` inside `server/sync.ts` and `server/sync/**`

## 4. Server: sync routes

- [x] 4.1 Create `server/sync/routes.ts` with a `createSyncRoutes(db: D1Database)` factory
- [x] 4.2 Implement `GET /sync/capabilities` returning `{ sync: true }` (no auth required)
- [x] 4.3 Implement `POST /sync/register`:
  - Extract `X-Sync-Key`, validate format (22 base64url chars)
  - Rate-limit per IP (10/hour, scope `register:<ip>`) — return 429
  - Rate-limit per global (1000/day, scope `register:global`) — return 503 when exhausted
  - Check global `users` row count against `MAX_USERS` cap — return 503 if at cap
  - `INSERT OR IGNORE INTO users (sync_key, created_at) VALUES (?, ?)`
  - Return 204
- [x] 4.4 Implement `POST /sync/otp`:
  - Require `X-Sync-Key`, rate-limit per key (20/hour, scope `otp:<key>`)
  - **Server generates the code** from the alphabet `[a-hj-km-np-z2-9]` (31 chars, no ambiguous chars), 8 chars long
  - Retry generation on collision (max 5 attempts; return 500 if all collide)
  - `INSERT INTO pairing_codes (code, sync_key, expires_at) VALUES (?, ?, ?)` (no `OR REPLACE` — collision-resistant due to generation)
  - Return 200 `{ code, expiresAt }`
- [x] 4.5 Implement `POST /sync/redeem`:
  - No `X-Sync-Key` required (this is the bootstrap)
  - Rate-limit per IP (10/min, scope `redeem:<ip>`)
  - Validate body `{ code: 8 chars from the allowed alphabet }`
  - `SELECT sync_key FROM pairing_codes WHERE code = ? AND expires_at > ?`
  - If found: delete the code (one-time use), return `{ syncKey }`
  - If not found: return 404
- [x] 4.6 Implement `POST /sync/push`:
  - Require `X-Sync-Key`, rate-limit per key (60/min, scope `push:<key>`)
  - Validate body shape: feeds/flags arrays, per-field `{value, at}` with numeric positive `at`
  - Validate that flag `feedUrl` matches the value derived from `itemId` (split at last `::`, decode)
  - Check per-user row cap (10K feeds, 1M flags) via `SELECT COUNT(*)` — return 413 if exceeded
  - For each row in the batch, run two statements inside `db.batch()`:
    1. `INSERT OR IGNORE INTO feeds/flags (sync_key, primary_key_cols, row_at) VALUES (?, ?, 0)`
    2. If the existing row is tombstoned (`deleted=1`), clear the tombstone: `UPDATE feeds SET deleted=0, deleted_at=NULL WHERE ... AND deleted=1`
    3. Per-field PATCH `UPDATE feeds SET field = CASE WHEN field_at IS NULL OR :at > field_at THEN :value ELSE field END, field_at = ... WHERE ...` for each field in the payload
  - Return 204
- [x] 4.7 Implement `GET /sync/pull?since=<ms>`:
  - Require `X-Sync-Key`, rate-limit per key (60/min, scope `pull:<key>`)
  - Default `since` to 0 if missing / null / empty
  - `SELECT * FROM feeds WHERE sync_key = ? AND row_at > ? ORDER BY row_at ASC`
  - `SELECT * FROM flags WHERE sync_key = ? AND row_at > ? ORDER BY row_at ASC`
  - Read current counter value as `serverTime`
  - Return `{ serverTime, feeds, flags }`
- [x] 4.8 Add a scheduled handler in `server/sync/cron.ts`:
  - `DELETE FROM feeds WHERE deleted = 1 AND deleted_at < ?` (30 days ago)
  - `DELETE FROM rate_limits WHERE window_start < ?` (largest window ago)
  - `DELETE FROM pairing_codes WHERE expires_at < ?` (1 day after expiry, just for cleanup of stale rows)
- [x] 4.9 Wire `createSyncRoutes` into `server/handle.ts` only when a D1 binding is passed via the factory
- [x] 4.10 Update `server/worker.ts` to read `c.env.DB` and pass it into `createApp()`
- [x] 4.11 Add a CORS guard: no `Access-Control-Allow-Origin` on any sync route, reject `OPTIONS` with 403
- [x] 4.12 Add an eslint override forbidding `console.*` inside `server/sync.ts` and `server/sync/**`

## 5. Client: sync key and settings

- [x] 5.1 Add `syncKey?: string | null` and `lastSyncAt?: number | null` to `AppSettings` in `src/db/types.ts`
- [x] 5.2 Update `DEFAULT_SETTINGS` in `src/db/types.ts` with the new fields
- [x] 5.3 Create `src/sync/key.ts` with `generateSyncKey()`, `isValidSyncKey(s)`, `getStoredSyncKey()`, `setStoredSyncKey()`, `clearStoredSyncKey()`
- [x] 5.4 Create `src/sync/capabilities.ts` with `isSyncAvailable()` that hits `/sync/capabilities` once on boot, caches the result for the page load only (not across reloads)
- [x] 5.5 Add the `qrcode-generator` dependency (or chosen small QR library) to `package.json`

## 6. Client: HTTP client

- [x] 6.1 Create `src/sync/client.ts` with `register()`, `issueOtp()`, `redeemCode()`, `pushDirty()`, `pullSince()`:
  - `fetch` wrappers with timeout
  - `Retry-After` respect
  - Exponential backoff (1s, 2s, 5s, 10s, max 60s) on 5xx or network error
  - 413 handling: split payload and retry (only for push)
  - 429 handling: respect `Retry-After` then back off
  - 401 handling: surface as "key invalid" error to the UI
- [x] 6.2 Add a constant `MAX_PUSH_BYTES = 1_000_000` and chunk size `MAX_DIRTY_PER_PUSH = 500`

## 7. Client: dirty set and push path

- [x] 7.1 Create `src/sync/queue.ts`:
  - **In-memory** array of dirty entries (not a single IDB blob re-serialized per enqueue)
  - `enqueueFeed(feed)` — records `feed-upsert` with all current field values
  - `enqueueFeedDelete(feedUrl)` — records `feed-delete` with `deleted=1`
  - `enqueueFlag(itemId, feedUrl, read?, starred?)` — records `flag-update` with changed fields only
  - `getDirty() -> DirtyEntry[]`, `clearDirty(ids)`, `clearAllDirty()`
  - `persistDirty()` — serializes the in-memory array to the IDB meta store under `sync_dirty` key
  - `loadDirty()` — restores the in-memory array from IDB on app boot
  - Bounded by `MAX_DIRTY_PER_PUSH` (500 entries): if the array exceeds this, trigger an immediate push rather than waiting for the debounce
  - IDB persistence triggers: on debounce, on `beforeunload`, on `visibilitychange` (to hidden), and after every successful push
- [x] 7.2 Create `src/sync/push.ts` with a debounced (1s) flusher:
  - Reads dirty set
  - Chunks into batches of 500
  - Calls `pushDirty(batch)` for each
  - On 2xx: clears the cleared entries
  - On 413: splits the chunk in half and retries
  - On 5xx / network: backoff
  - On 429: respects `Retry-After`
  - Exposes a `flushNow()` for manual triggers

## 8. Client: pull path and apply

- [x] 8.1 Create `src/sync/apply.ts` with `applyRemoteState(payload, localTimestamps)`:
  - For each feed: upsert into `feeds` store with per-field timestamp comparison
  - For each tombstoned feed: call `unsubscribeFeed(feedUrl)` if `deleted_at` is newer than any local `lastFetched`
  - For each flag: upsert into `itemFlags`, update `items.read`/`items.starred` for items present locally
  - For unknown-item flags: store in `itemFlags`, apply when item appears
- [x] 8.2 Create `src/sync/merge.ts` with `mergeForFirstTime(localSnapshot, remotePayload)`:
  - In-memory merge with per-field server-newer-wins
  - Returns merged snapshot
- [x] 8.3 Create `src/sync/init.ts`:
  - `bootSync()` — if `syncKey` is set, call `bootFirstTime()` (if `lastSyncAt` is null) or `bootPull()` (if set)
  - `bootFirstTime()` — push all local, pull `since=0`, merge, apply, re-push
  - `bootPull()` — pull `since=lastSyncAt`, apply, update `lastSyncAt = max(current, serverTime)`
- [x] 8.4 Add a `visibilitychange` handler that calls `pullIfStale(30_000)`
- [x] 8.5 Add an `online` event handler that calls `pullNow()`
- [x] 8.6 Add an `applyItemId(itemId) -> { feedUrl, guid }` helper that splits at the last `::` and `decodeURIComponent`s the feed URL

## 9. Client: integration into state.tsx

- [x] 9.1 Modify `src/state.tsx`:
  - **Enqueue site decision: the call site nearest the DB write calls `enqueue*`**. The DB layer (`src/db/items.ts`, `src/db/feeds.ts`, `src/db/flags.ts`) remains sync-unaware and pure — it does not call `enqueue*`. Each user action follows the pattern: `await dbWrite()` → `enqueue*()` → `setState(...)`. This is true for `state.tsx` wrappers, components (`River.tsx`, `ReadingView.tsx`, `AddFeedModal.tsx`, `ConfirmUnsubscribeModal.tsx`), and the MCP event handler — all of which call `enqueue*` immediately after their local IDB write. The implementation should audit each of these call sites to ensure the enqueue is wired correctly; a unit test enumerating them is appropriate.
  - Hook `markRead`, `toggleStar`, `upsertFeed`, `unsubscribeFeed` to enqueue into the dirty set after the local IDB write
  - Replace the boot sequence to: load settings → `bootSync()` → reload feeds → reload items → start scheduler → `startMcp()` (MCP is started last so it doesn't fire `add-feed` during the sync merge)
  - Register the `visibilitychange` and `online` handlers
  - Add a `syncNow()` exposed on the AppContext
- [x] 9.2 Add a `triggerEnableSync()` function for the user-initiated enable path: opens the pairing modal in receiving mode, accepts a code or key, runs the first-time setup merge inline (does not wait for next boot)
- [x] 9.3 Modify the toggle-off path to clear `syncKey`, `lastSyncAt`, and the dirty set on confirmation
- [x] 9.4 Modify the regenerate path to keep the dirty set and `lastSyncAt`, but generate and store a new key; the next push will register the new key on the server

## 10. Client: UI

- [x] 10.1 Create `src/sync/qr.ts` that wraps `qrcode-generator` for 22-byte keys with error correction M; returns an SVG string
- [x] 10.2 Create `src/components/PairDeviceModal.tsx`:
  - **Primary flow: pairing code**. The "Issue pairing code" button calls `POST /sync/otp` and displays the returned 8-character code in a monospace font with letter-spacing, plus a 5-minute countdown. The "Waiting for another device to pair…" state shows below the code until the source's next pull detects the target's first push.
  - **Secondary flow: paste the sync key directly**. The 22-character key with a copy button is always shown for users who prefer direct paste over the OTP roundtrip.
  - **Tertiary flow: QR code** (deferred to v2 for camera scanning). The QR is rendered for visual reference with a note that camera scanning is coming.
  - Input field for the target: validates input (8 chars from the OTP alphabet OR 22 base64url chars), calls `redeemCode` or stores the key directly
  - On wide screens: code on the left, key + QR on the right
  - On narrow screens: stacked
- [x] 10.3 Modify `src/components/SettingsDrawer.tsx`:
  - Add the Sync section, conditionally rendered when `isSyncAvailable()` is true
  - Sync-off state: description + "Enable sync" button
  - Sync-on state: "Pair device" button → opens modal; "Last synced" with 30s update; "Sync now" button; "Regenerate" with confirm dialog
  - On first display of the key: backup notice
  - Update the "Last synced" string on a `setInterval(30s)` while the drawer is open
  - While the first-time merge is in progress (mid-session enable): show a "Syncing…" indicator
- [x] 10.4 Add CSS for the Sync section and pairing modal in `src/styles.css`

## 11. Tests

- [x] 11.1 Add `tests/sync-server.test.ts`:
  - Bearer auth: 401 on missing header, 401 on malformed key, 401 on unknown key (no row creation), 204 on known key
  - Register: 204 on first call, idempotent on second call, 429 above rate limit
  - OTP: 204 on issue, 200 on redeem with syncKey, 404 on unknown code, 404 on expired code, one-time use
  - Push: per-field PATCH semantics, PATCH with newer timestamp wins, PATCH with older timestamp preserves server, 413 above row cap
  - Pull: returns rows with `row_at > since`, includes `serverTime`, `since=0` returns all
  - Monotonic time: timestamps increase even when wall clock regresses
  - No CORS headers
  - Garbage collection: scheduled handler removes old tombstones and rate-limit rows
- [x] 11.2 Add `tests/sync-client.test.ts`:
  - Dirty queue: enqueue / getDirty / clearDirty round-trip
  - Apply: feed upsert, tombstone triggers unsubscribe, flag update for known and unknown items
  - First-time merge: push → pull → merge → apply → re-push produces consistent state
  - Item-ID encoding: round-trip with feed URLs containing `::`
  - Backoff: 5xx triggers retry, 429 respects `Retry-After`
- [x] 11.3 Add `tests/qr.test.ts`:
  - For a 22-byte input, the encoded QR matrix decodes to the same string with a known-good decoder (`jsQR`)
- [x] 11.4 Add `tests/pairing-flow.test.ts`:
  - Source issues code, target redeems, target stores key, target pulls state
- [x] 11.5 Add an end-to-end test: device A pushes a feed and 5 flags, device B (empty IDB) pulls, device B's state matches, device A re-marks one flag, device B pulls, device B's flag reflects the change

## 12. Verify

- [x] 12.1 Run `npm run typecheck` and resolve all errors
- [x] 12.2 Run `npm run lint` and resolve all warnings
- [x] 12.3 Run `npm test` and ensure all tests pass
- [x] 12.4 Run `npm run build` and ensure the bundle builds without errors
- [ ] 12.5 Manual test: enable sync on two browser profiles (or two browsers), verify subscriptions and flags propagate
- [ ] 12.6 Manual test: enable sync on device A, type the 8-character code on device B, verify same propagation
- [ ] 12.7 Manual test: paste full sync key on device B, verify same propagation
- [ ] 12.8 Manual test: regenerate key on device A, verify device B is prompted to re-pair
- [ ] 12.9 Manual test: toggle off, verify dirty set is cleared, toggle on with new key, verify no stale data is pushed
- [ ] 12.10 Manual test: simulate server with no D1 binding, verify Sync section is hidden
- [ ] 12.11 Manual test: verify rate limit on register (e.g., 11 requests in an hour from the same IP returns 429)
- [ ] 12.12 Manual test: verify per-field PATCH — change one field on device A, change a different field on device B, verify both changes are preserved after sync
