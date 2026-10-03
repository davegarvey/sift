## Why

Feeds are fetched only while a Sift tab is open, and every device fetches every feed independently through the proxy. Most feeds publish only their latest 10–50 entries, so when no device is open for a day or two, busy feeds drop items that Sift never records. The loss is silent. The same model multiplies upstream traffic by devices and open tabs, which is what the URL cooldown, origin governor and stale serving were built to contain, and it means a newly paired device starts with nothing until it has fetched every feed itself.

Synced accounts already store their subscription URLs in D1, and the Worker already has a cron trigger and the shared feed fetch path. A scheduled Worker can fetch each distinct subscribed URL once, keep a short window of new items, and let devices pull them through sync.

## What Changes

- A Worker cron polls each distinct feed URL subscribed by an active synced account, through the existing `/feed` fetch path (cache, cooldowns, origin governor), and records new items in a separate poll database (`POLL_DB`).
- The poll database holds a registry of URLs to poll: subscribing adds a URL, and a daily maintenance pass rebuilds the registry from active accounts, at most 500 feeds per account. Polling runs group feeds by host and never escalate backoff for limits Sift imposes on itself.
- Items are stored once per feed URL, not per account: title, link, author, date, excerpt, thumbnail and feed HTML up to 64 KiB. They are kept for 7 days from first sight, and polling pauses if the poll database approaches D1's size cap.
- A new paginated `GET /sync/items` route returns retained items for the caller's live subscriptions, ordered by an insertion sequence.
- Clients pull items after each sync pull and insert only items they do not already hold. Browser fetching, local-only mode and manual refresh are unchanged.
- The feature is opt-in per deployment through the `FEED_POLLING` Worker variable and a `POLL_DB` binding, requires Workers Paid, and is advertised through `/sync/capabilities`.
- **BREAKING (principle)**: the sync server now stores item metadata and feed HTML for subscribed feeds. The "server stores only sync-relevant data" requirement and the README privacy section change accordingly.

## Capabilities

### New Capabilities

- `server-feed-polling`: Scheduled server-side polling of synced subscriptions, item retention, the items pull route and client gap filling.

### Modified Capabilities

- `device-sync`: The server may store retained feed items for subscribed feeds when polling is enabled; capabilities advertise item sync.

## Impact

- `server/feed-poller.ts` and `server/poll-registry.ts` (new), `server/worker.ts`, `server/handle.ts`, `server/sync/routes.ts`, `server/sync/schema.ts`, `server/sync/ratelimit.ts`.
- Sync migration `0009_account_activity.sql` (`users.last_active_at`); poll migrations in `server/migrations-poll/` (`polled_feeds`, `polled_items`, `poll_meta`).
- `wrangler.toml`: the `POLL_DB` binding, a 10-minute cron and the `FEED_POLLING` variable; deploy scripts apply both databases' migrations.
- `src/feeds/parse.ts`, `src/db/items.ts`, `src/db/types.ts`, `src/sync/client.ts`, `src/sync/merge.ts`, `src/sync/capabilities.ts`, `src/sync/key.ts` and the places that reset sync cursors.
- README privacy and deploy text.
- No new dependencies. The Worker bundle gains the feed parser already used by the client.
