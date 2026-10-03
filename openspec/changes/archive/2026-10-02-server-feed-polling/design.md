## Context

Browsers fetch feeds through `/feed` on a per-feed schedule while a tab is visible (`src/feeds/scheduler.ts`). The Worker proxy wraps upstream requests in a fresh/retained cache, URL and origin cooldowns and a request governor (`server/fetch.ts`, `server/origin-governor.ts`). Sync stores subscriptions per sync key in the D1 `feeds` table and item flags in `flags`; statistics use a separate pull with its own cursor and a `/sync/capabilities` flag. The Worker runs a daily cron for cleanup. Items are identified as `${feedId}::${guid}` locally, and the guid comes from `parseFeed`, which runs on `@extractus/feed-extractor` and has no DOM dependency.

Sift is publicly reachable and accepts up to 100,000 accounts (`MAX_USERS`), each with up to 10,000 feeds. The design therefore has to bound per-run cost, storage and one account's share of the work independently of how many people sign up.

## Goals / Non-Goals

**Goals:**

- Items published while no device is open are still delivered to synced devices, within a 7-day window.
- Each subscribed URL is fetched by the server at most once per poll interval regardless of the number of accounts or devices.
- A newly paired device receives recent items without fetching every feed first.
- Per-run cost does not grow with the number of accounts; storage cannot exhaust the sync database; no single account can dominate polling.
- Browser behaviour for local-only users is unchanged.

**Non-Goals:**

- Removing browser fetching or the proxy's cooldown and governor logic.
- Server-side Readability extraction or image inlining.
- Polling on the Node/Bun servers or the Vite dev shim; sync itself is Workers-only.
- Exposing items to `siftctl` or MCP; the route accepts agent credentials, but no client uses it yet.
- Fan-out through Cloudflare Queues; one cron invocation per tick is enough for the expected scale.
- Push notifications.

## Decisions

### Opt-in per deployment, with a separate poll database

Polling runs only when the Worker variable `FEED_POLLING` is `"true"` and a second D1 database is bound as `POLL_DB`; either missing disables polling and the `items` capability. It requires Workers Paid: a Free-plan invocation may make 50 subrequests (D1 queries, Cache API calls and fetches all count), and one polled feed costs about 5 D1 queries and 11 subrequests.

Polling state and items live in `POLL_DB`, with migrations in `server/migrations-poll/`. D1 caps a database at 10 GB and a full database rejects writes; keeping items apart means a full poll database can never block sync. The sync database gains only `users.last_active_at`.

Alternative considered: one database. Rejected because item storage grows with the number of distinct feeds on the internet that users follow, which Sift does not control, while sync storage grows with users' own actions.

### A registry of URLs to poll

`polled_feeds` in the poll database is the registry. A URL enters it in two ways:

- **On subscribe.** `/sync/push` registers the URLs of feeds pushed with `deleted: 0` in one statement, provided the account's live feed count is within the per-account cap. Registration failures are swallowed; maintenance repairs them.
- **Daily maintenance.** The poll cron runs maintenance instead of polling when more than 24 hours have passed since the last pass (recorded in `poll_meta`), including on the very first run after deployment. Maintenance pages through non-rotated accounts that pulled within 14 days (500 at a time), takes up to 500 live feeds per account ordered by `feed_id`, and reconciles the registry: missing URLs are added, URLs no longer wanted are removed, and items first seen more than 7 days ago are deleted in chunks of 10,000.

`/sync/pull` writes `users.last_active_at` at most once an hour per account.

Each polling run therefore reads only the `next_poll_at` index of the registry; the cost of choosing work no longer grows with the number of subscriptions. Measured against Miniflare, maintenance for 5,000 accounts × 50 subscriptions (20,000 distinct URLs) took 65 D1 queries and 0.3 s; the query count grows by about 2 per 500 accounts, so the 100,000-account cap stays near 450 queries, under the 1,000-query limit.

Alternatives considered: scanning `feeds` on every run (the first version of this change), which costs a full read of every subscription row each ten minutes and holds the single-threaded sync database while it runs; and refreshing the registry on every pull, which multiplies registry writes by the number of devices.

### Per-account cap

At most 500 feeds per account are polled (`MAX_POLLED_FEEDS_PER_ACCOUNT`), and `/sync/items` only considers those same 500 feeds. Accounts above the cap keep browser fetching for the rest. This bounds one account's share of the queue and the storage.

### One batch per cron tick, host lanes and leases

A cron fires every 10 minutes. Each run reads up to `FEED_POLL_BATCH` (default 50) due URLs, oldest `next_poll_at` first. Before fetching it leases them in one statement by moving `next_poll_at` forward by the poll interval, so an interrupted run does not leave the same URLs at the head of the queue and overlapping runs do not select the same URLs.

The batch is split into lanes by host. Up to four lanes run concurrently and each lane fetches its host's feeds one after another. The governor allows one request per second per host, four in flight, and a queue wait of 5 seconds. The poller therefore keeps at most one request per host in flight and leaves the host's remaining slots to browsers.

After a success the URL is due again in 30 minutes (or later if a retained copy reports `X-Sift-Retry-After`). After an upstream failure it waits for the larger of `Retry-After` and an exponential backoff from 30 minutes, capped at 24 hours. When the response was produced locally, by the governor (`local-gate`), an origin cooldown or a URL cooldown recorded earlier, the URL is rescheduled for the indicated time (at least one minute) without counting a failure, so shared host limits never escalate a feed's backoff. A URL that fails target validation waits 24 hours.

Fetches go through `validateUpstreamUrl` and `fetchFeedCached` with the stored ETag and Last-Modified and the sync database for shared cooldowns. The poller therefore shares the cache with browsers, honours URL and origin cooldowns, and receives `304` when nothing has changed.

With the defaults a deployment makes up to 7,200 polls a day, enough for about 150 distinct feeds at the 30-minute interval; beyond that, feeds are polled less often in round-robin order. A run of 50 feeds with 100 items each measured 255 D1 queries and 555 subrequests against Paid limits of 1,000 and 10,000, so operators can raise the batch to roughly 150.

### Storage guard

Each run reads the poll database size from the D1 result metadata of the due-feeds query. Above `POLL_DB_MAX_BYTES` (default 8 GiB, below D1's 10 GB cap) the run polls nothing and logs `feed_poll.storage_full`; maintenance continues to expire items, so polling resumes once space is freed.

### Store items once per URL with an insertion sequence

`polled_items` is keyed by `(feed_url, guid)` with an `AUTOINCREMENT` `seq`. Rows are inserted with `INSERT OR IGNORE ... SELECT FROM json_each(?)`, one statement per feed (split only when the JSON would exceed 1 MB, below D1's 2 MB value limit), because D1 counts each statement in a batch towards its per-invocation query limit. Rows are never updated, so `seq` is a stable, strictly increasing cursor. Stored fields: title, link, author, `published_at` (null when unusable), excerpt (already capped at 500 characters), thumbnail URL, feed HTML when its UTF-8 size is at most 64 KiB, and `first_seen_at`. At most 100 entries are taken from one feed body.

Alternative considered: stamping items with the monotonic `row_at` used by `/sync/pull`. Rejected because a single poll stamps many rows with one value, which prevents stable pagination.

### Paginated items pull without a cross-database join

`GET /sync/items?after=<seq>` authenticates like `/sync/pull` and has its own rate limit. It reads the caller's first 500 live feeds from the sync database and `MAX(seq)` from the poll database, then selects up to 200 rows with `feed_url IN (SELECT value FROM json_each(?)) AND seq > after AND seq <= max`, which SQLite answers from the `(feed_url, seq)` index. Each row is returned with the caller's lowest `feed_id` for its URL and without the URL. The response is `{ items, cursor, more }`: when the page is full, `cursor` is the last returned `seq` and `more` is true; otherwise `cursor` is the `max` read at the start, so items for feeds the account does not follow advance the cursor without being returned.

An account that subscribes to a URL after its items were inserted does not receive that backlog; the device that subscribes fetches the feed's current window itself. A device running first-time setup starts from cursor 0 and receives everything retained for its subscriptions.

### Client inserts only missing items

After a sync pull (normal or first-time) has applied feeds and flags, the client pulls item pages until `more` is false, with at most 50 pages per run, and stores the cursor as `lastItemsCursor` in settings. Rows are converted with the same mapping as `parsedToItems`; when `published_at` is null the server's `first_seen_at` is the fallback date and the item is flagged `dateFallback`. Rows for feed IDs not present locally are skipped. Items are written through `bulkUpsertItems` with an insert-only option, so a copy the browser already fetched (which may carry larger HTML or extracted content) is never overwritten, while synced read and starred flags still apply to new rows. Feed statistics for affected feeds are queued for sync, and the UI refreshes through the existing sync callback. The cursor is cleared wherever `lastSyncAt` is cleared. Item pull failures are logged and do not fail the sync pull or first-time setup, because item sync supplements, rather than replaces, browser fetching.

Inserting a new item now also copies a previously synced read or starred flag onto the item record. Before this change only the flag store received it, so an item whose flag arrived first (common after pairing) was shown as unread in the river.

## Risks / Trade-offs

- **[Principle] The server now holds item content for synced accounts** → Limited to 7 days, bounded HTML, shared per URL rather than per account, never logged, and opt-in per deployment. README and the device-sync requirement are updated.
- **[Privacy] Private feeds with secret tokens in their URLs are polled and their items stored** → Only a caller whose own subscriptions contain the exact URL can read them, which already grants access to the feed. Documented in the README.
- **[Capacity] Throughput is fixed per run** → Feeds beyond about 150 (defaults) are polled less often, round-robin. `FEED_POLL_BATCH` raises it to roughly 450 feeds at 30 minutes; beyond that, polling needs fan-out through Queues.
- **[Cost] Storage grows with distinct feeds** → Separate database, 7-day retention, 64 KiB HTML cap, per-account cap and the storage guard bound it.
- **[Behaviour] New subscriptions of accounts above the cap are not registered on push** → Maintenance registers the first 500 by `feed_id`; browsers fetch the rest as before.
- **[Behaviour] Unsubscribed or inactive URLs are polled for up to a day** → Removed at the next maintenance pass.
- **[Behaviour] Item-level HTML above 64 KiB is dropped** → The reader falls back to Readability extraction, as it does for summary-only feeds.
- **[Operational] A second D1 database must be created** → Documented in the README; without it polling stays off.
