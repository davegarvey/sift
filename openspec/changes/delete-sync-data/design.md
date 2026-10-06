## Context

Sync stores state per sync key in the D1 `sift-sync` database. Nothing deletes an account: disabling sync only clears the key in the browser, rotation (`POST /sync/rotate`) creates a new `users` row and marks the old one `rotated_at` without moving or deleting data, and the daily cron removes only tombstoned feeds, expired pairing codes, rate-limit rows and shared upstream metadata. The `users` table also holds `last_active_at`, added with server polling, which `/sync/pull` writes at most hourly.

The poll database (`sift-poll`) is separate and keyed by feed URL. Its registry is rebuilt daily from accounts that exist, are not rotated and pulled within 14 days. It holds complete feed URLs, including tokens embedded in private-feed URLs, so a deleted account's polling state is personal data until it is removed.

## Goals / Non-Goals

**Goals:**

- A person can delete everything the server holds under their sync key, from the browser, and the result is verifiable.
- Accounts nobody uses are deleted on a fixed schedule that the privacy policy can state.
- Deletion never affects another account, including through shared polling state.
- A device that still holds a deleted key fails once, clearly, and does not hammer the server.

**Non-Goals:**

- Export of server-side data, administrator deletion of other people's accounts, `siftctl` support, and changes to local IndexedDB eviction (as in the proposal).
- Preventing a deleted or rotated key from being registered again. Registration of an unknown key has always been open; see Risks.

## Decisions

### One route, master key only

`DELETE /sync/account`, mounted behind `requireMaster`, so agent tokens receive `401` as on `/sync/otp` and `/sync/tokens`. The route checks the per-key rate limit (`account-delete:<key>`, 10 per hour) before changing anything, collects the account's feed URLs when polling is enabled, runs one `db.batch` and then cleans up polling state.

A repeat request gets `401`, because authentication looks the key up in `users`. The alternative, accepting any well-formed key and deleting by key without a lookup, would give `204` on repeat and let a holder of a rotated key delete its rows, but it needs a rate-limit write for every unauthenticated request, which is the quota-drain pattern `requirePullPrincipal` avoids. State is idempotent either way; the client treats `401` as "already gone". The consequence is that the per-key rate limit can be reached only if a delete fails repeatedly, since a successful one removes the key. It remains to bound that case.

### Which rows are deleted

| Table | Decision | Reason |
| --- | --- | --- |
| `users` | Delete the row | The account itself. Deleting it also makes `authenticate` reject any surviving token or key. |
| `feeds` | Delete all rows, including tombstones | Keyed by `sync_key`; contains feed URLs and titles. |
| `flags` | Delete all rows | Keyed by `sync_key`; item IDs embed feed IDs. |
| `feed_stats` | Delete all rows | Keyed by `sync_key`; includes feed URL and title. |
| `tokens` | Delete all rows | Keyed by `sync_key`; revokes agent access at once. |
| `pairing_codes` | Delete all rows for the key (device and agent) | Keyed by `sync_key`; an agent code on `/sync/pull?code=` would otherwise outlive the account for up to five minutes. |
| `rate_limits` | Delete the rows whose scope is `<route prefix>:<key>` (nine prefixes) | The scope embeds the key. Per-IP scopes (`register:`, `redeem:`, `tokens:redeem:`) and `register:global` are not account data and stay. |
| `counters` | Keep | One global row (`server_time`). |
| `feed_fetch_failures`, `upstream_origin_policy` | Keep | Keyed by SHA-256 of a URL or origin, shared by all accounts, expired by the cron on their own timers. |
| `feeds_next`, `flags_next` | Nothing to do | Exist only inside migration `0008`, which renames them. |

Rate-limit rows are deleted by exact scope (`scope = ?`, primary-key lookups) rather than by a suffix match. A suffix match would cover future routes automatically but scans the table and needs SQL the local D1 shim does not support. `KEYED_RATE_LIMIT_PREFIXES` in `server/sync/ratelimit.ts` lists the prefixes, and a test reads `routes.ts` and fails when a keyed scope is added without being listed.

The batch is one transaction per account. A very large account (up to 1,000,000 flags) deletes in a single statement; D1 has no row limit on a delete, only an execution time limit, and the route is the user's own request. The cron deletes one account per batch for the same reason.

### Polling state is removed immediately where no one else needs it

After the batch, the route removes each of the account's URLs that no live feed row in the sync database references, from both `polled_feeds` and `polled_items` (items carry the URL, and so any embedded token). The check uses a new partial index, `idx_feeds_live_feed_url ON feeds(feed_url) WHERE deleted = 0 AND feed_url IS NOT NULL` (migration `0010`, mirrored in `ensureSchema`), so it is an index lookup rather than a scan of every account's feeds. Writes to the index are limited to live feeds.

The check is deliberately conservative. A live feed row of an inactive account keeps the URL registered until the daily rebuild removes it. The step runs after the sync-database batch and is best-effort: a failure leaves the URLs for the daily maintenance, which rebuilds the registry from accounts that still exist. Items of URLs removed by maintenance continue to expire after seven days as before.

The retention cron does not touch the poll database. Accounts it deletes have been inactive for a year or rotated for a month, so they left the registry's 14-day window long ago and their unshared URLs and items have expired.

### Activity is a pull, recorded whether or not polling is on

`last_active_at` was written only when polling was enabled, so on a deployment without polling every row had a null value and a time-based retention rule would have fallen back to `created_at` for accounts in daily use. Pull now records activity unconditionally, at most hourly, as before. A pull by an agent token or agent code counts, since an agent reading the data is use of the account. Pushes do not: every client pulls on boot, focus and refresh, and the polling spec already defines activity as a pull.

### Retention windows

- **Inactive: 365 days** from `COALESCE(last_active_at, created_at)`. The fallback matters for rows that never pulled and for rows from before activity was recorded unconditionally. Because device sync was archived on 2026-08-04, no hosted account can be a year old before August 2027, so a null `last_active_at` cannot cause an early deletion in the first release. The query excludes rotated rows.
- **Rotated: 30 days** from `rotated_at`, whatever the last activity.

Whether 30 days is enough for devices to adopt the new key: it is not what the period is for. Rotation does not migrate anything and the old key is rejected at once (`authenticate` returns `401` for `rotated_at IS NOT NULL`, for tokens too). A paired device never adopts the new key by itself; the user pairs it again with a code from a device holding the new key (`regenerate` tells them so). From the moment of rotation nothing can read the old rows, so the period only delays erasure. It is kept because the proposal asks for a grace period, because it costs nothing, and because it leaves time to restore a mistaken rotation by hand. It could be shortened without harming any device.

The cron selects expired keys in three bounded queries (rotated, inactive, never active), takes at most 50 accounts per run, rotated first, and deletes each account in its own batch with the same statements as the route, minus `rate_limits` (rows older than 24 hours are removed earlier in the same run, and these accounts have no newer ones). It continues after a failed account and rethrows the first error at the end so the failure is visible. 50 accounts at one batch each stays well inside the Workers Paid subrequest budget that polling already requires. A backlog clears at 50 a day.

### Client: a rejected key fails once and stops automatic retries

`withRetry` only retries `429`, and no request retried a `401`, so there was no loop in the request layer. Two things were still unhelpful. The message was "Pull failed: 401", and every focus, online event and local change (each schedules a push) sent another doomed request.

`SyncClientError` for any `401` on pull, push, statistics or items now carries a fixed message that says what to do. `markError` sets a `keyRejected` flag on a `401`; while it is set, `scheduleFlush` and `pullIfStale` do nothing. `pullNow` and `flushNow` called directly (Sync now, manual refresh) still try, and any successful pull or push clears the flag. `disableSync` clears it and the error. Queued changes stay queued. Settings shows the message under the status line, because the status line's detail is only a tooltip. There is no separate "account deleted" screen: the server cannot tell a deleted key from a never-registered one, and the right action (pair again or turn sync off) is the same.

### Settings

A "Delete sync data" row below "Regenerate" opens the existing confirm modal in danger style. On confirmation the drawer calls `deleteSyncAccount()` and then `disableSync()`. `401` counts as success. Other failures keep sync on and show an inline error held in a module-level signal, because the confirm modal closes and reopens the drawer, which would discard component state. `disableSync` already clears the key and `lastSyncAt`, so re-enabling generates a new key.

The disable confirmation said that "other devices will stop syncing", which is wrong (they keep their key and keep syncing) and that data is kept "until you generate a new key". It now says that this device stops syncing, that the data stays and other paired devices keep syncing, and that to delete the data the user must cancel and use Delete sync data first, since this device no longer has the key afterwards.

### Local D1 shim

`server/sync/local-d1.ts` backs `npm run dev` and several tests. Writing the retention queries exposed three bugs in it that would have made the shim delete live accounts: `<`, `>` and `>=` treated null as 0, a leading `IS NULL` / `IS NOT NULL` ignored the rest of the clause, and `LIMIT` was read as part of the `WHERE`. The shim now follows SQL semantics for these and applies `LIMIT`. This is limited to what the new queries need.

## Risks / Trade-offs

- **The cron deletes production data.** Windows are long and the first inactive deletions cannot occur before August 2027, but rotated accounts older than 30 days are deleted on the first run after release, at 50 a day. Deleted rows are not recoverable through the application. D1 Time Travel may keep point-in-time history of the sync database for a period set by the plan (30 days on Workers Paid is the documented figure); I have not checked how this deployment is configured, and the privacy policy should say that erasure from backups follows that period.
- **A deleted or rotated key can be registered again.** Registration of an unknown key has always been open, and `register` refuses only rows that are still rotated. After a rotated row is deleted its key is unknown, so a holder of the old key can register an empty account under it. Nothing from the old account survives, and no route gives access to the new account's key. A device that explicitly pairs or enables sync with that key (and `issueOtp`, which registers on a `401`) recreates an empty account and then syncs its local data into it. That needs a user action and matches the behaviour for any unknown key; it is noted rather than prevented. Preventing it needs a tombstone for deleted keys, which would itself be retained data.
- **Per-key delete rate limit is nearly unreachable.** It exists for consistency and to bound repeated failures.
- **Delete is one batch for large accounts.** Acceptable for a user-initiated rare operation; revisit if a real account exceeds D1's statement time limit.
- **The partial index adds a write to live feed inserts and updates.** Feed writes are small and infrequent compared with flag writes, which are unchanged.
- **Existing spec text is stale in places.** The `Regenerate preserves dirty set` requirement still describes auto-register on `401`, and `Stolen device recovery` says the server keeps accepting the old key. Both describe behaviour that rotation replaced. They are not changed here beyond what this change touches.
