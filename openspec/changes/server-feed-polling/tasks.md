## 1. Server storage and polling

- [x] 1.1 Add poll-database migration `0001_feed_polling.sql` for polling state and sync-database migration `0009_account_activity.sql` for `users.last_active_at`.
- [x] 1.2 Record account activity from `/sync/pull`, at most hourly.
- [x] 1.3 Implement the poller: due-URL selection, bounded concurrent fetches through `fetchFeedCached`, parsing, item insertion and rescheduling.
- [x] 1.4 Wire a 10-minute cron and the `FEED_POLLING` / `FEED_POLL_BATCH` variables into the Worker; keep the daily cleanup on its own cron.
- [x] 1.5 Add daily poll-database maintenance to delete expired items and reconcile polling state with active subscriptions.

## 2. Items route

- [x] 2.1 Add `GET /sync/items` with pagination, authentication and rate limiting, and the `items` capability, both gated on polling.
- [x] 2.2 Cover the route and poller with Miniflare D1 tests.

## 3. Client

- [x] 3.1 Extract a single-item mapping from `parsedToItems` and add an insert-only mode to `bulkUpsertItems`.
- [x] 3.2 Add the items capability, cursor storage and pull client, and pull items after normal and first-time sync; clear the cursor with `lastSyncAt`.
- [x] 3.3 Cover conversion, insert-only merging and the pull loop with tests.

## 4. Multi-tenant hardening

- [x] 4.1 Move polling state and items to a separate `POLL_DB` with its own migrations.
- [x] 4.2 Replace the per-run subscription scan with a registry filled on push and rebuilt by daily, paged maintenance.
- [x] 4.3 Cap polled feeds per account at 500, in maintenance, push registration and the items route.
- [x] 4.4 Group runs by host and defer, without counting a failure, on locally produced rate limits and cooldowns.
- [x] 4.5 Skip runs when the poll database exceeds `POLL_DB_MAX_BYTES`.
- [x] 4.6 Create the `sift-poll` database, bind it in `wrangler.toml` and apply its migrations in the deploy scripts.

## 5. Wrap-up

- [x] 5.1 Update README privacy, deploy and configuration text.
- [x] 5.2 Run typecheck, lint and tests; validate the change.
