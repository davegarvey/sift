# server-feed-polling Specification

## Purpose

This capability lets a Workers deployment poll the feeds that active synced accounts follow, retain new entries for seven days in a separate poll database, and deliver them to devices through sync, so that items published while no device is open are not lost.

## Requirements

### Requirement: Polling is opt-in per deployment

The Worker SHALL poll feeds and serve item sync only when its `FEED_POLLING` variable is `"true"` and a poll database is bound as `POLL_DB`. Polling state and items SHALL be stored in the poll database, not in the sync database. `/sync/capabilities` SHALL report `items: true` only in that case. Node, Bun and the development server SHALL report `items: false` or omit it.

#### Scenario: Polling disabled
- **WHEN** `FEED_POLLING` is unset
- **THEN** the scheduled handler SHALL NOT fetch any feed
- **AND** `/sync/capabilities` SHALL NOT report `items: true`
- **AND** `GET /sync/items` SHALL return `404`

#### Scenario: Poll database missing
- **WHEN** `FEED_POLLING` is `"true"` and no `POLL_DB` binding exists
- **THEN** polling and item sync SHALL be disabled

### Requirement: Registry of URLs to poll

The poll database SHALL hold a registry of feed URLs to poll. When `/sync/push` receives a feed with `deleted: 0` and a URL, and the account's live feed count is at most 500, the server SHALL add the URL to the registry. A failure to register SHALL NOT fail the push. `/sync/pull` SHALL record the account's activity time at most once per hour.

When more than 24 hours have passed since the last maintenance pass, a polling run SHALL perform maintenance instead of polling. Maintenance SHALL rebuild the registry from the live subscriptions of accounts that are not rotated and have pulled within the previous 14 days, taking at most 500 feeds per account ordered by feed ID; it SHALL add missing URLs, remove URLs no longer wanted and delete items first seen more than 7 days earlier. Maintenance SHALL read accounts in pages so that its cost does not depend on a single large query.

#### Scenario: New subscription
- **WHEN** an active account pushes a new feed
- **THEN** its URL SHALL be due for polling immediately

#### Scenario: Shared subscription
- **WHEN** three active accounts subscribe to the same URL
- **THEN** the registry SHALL contain the URL once
- **AND** a polling run SHALL fetch it at most once

#### Scenario: Inactive account
- **WHEN** the only account subscribing to a URL last pulled 20 days ago
- **THEN** the next maintenance pass SHALL remove the URL from the registry

#### Scenario: Unsubscribed feed
- **WHEN** the last account following a URL unsubscribes
- **THEN** the next maintenance pass SHALL remove the URL from the registry

#### Scenario: Account above the cap
- **WHEN** an account follows 520 feeds
- **THEN** maintenance SHALL register only the 500 with the lowest feed IDs

### Requirement: Bounded, scheduled polling through the shared fetch path

Each run SHALL fetch at most `FEED_POLL_BATCH` URLs (default 50), in order of their next due time. Before fetching, the run SHALL lease the selected URLs by making them due again after 30 minutes. The run SHALL group URLs by host, fetch each host's URLs one at a time and run at most four hosts concurrently. Fetches SHALL use the same target validation, cache, cooldowns and origin governor as `/feed`, with the ETag and Last-Modified from the previous poll. After a successful poll the URL SHALL be due again in 30 minutes. After an upstream failure it SHALL be due after the larger of the response's `Retry-After` and an exponential backoff starting at 30 minutes, capped at 24 hours. When the failure was produced locally by the request governor, an origin cooldown or a recorded URL cooldown, the URL SHALL be due at the indicated retry time (at least one minute later) and its failure count SHALL NOT increase. A URL that fails target validation SHALL be due again in 24 hours.

#### Scenario: Unchanged feed
- **WHEN** a poll receives `304`
- **THEN** no items SHALL be written
- **AND** the URL SHALL be due again in 30 minutes

#### Scenario: Rate-limited feed
- **WHEN** a poll receives `429` with `Retry-After: 7200` from the upstream
- **THEN** the URL SHALL NOT be polled again for two hours

#### Scenario: Shared cooldown
- **WHEN** a URL cooldown recorded by an earlier request is still active
- **THEN** the poll SHALL NOT contact the upstream
- **AND** the URL's failure count SHALL be unchanged

#### Scenario: Many feeds on one host
- **WHEN** a run selects eight feeds on the same host
- **THEN** it SHALL fetch them one after another and record each result

#### Scenario: Run interrupted
- **WHEN** a polling run selects a URL and stops before recording the result
- **THEN** the URL SHALL NOT be due again for 30 minutes

#### Scenario: Cached copy is fresh
- **WHEN** a browser fetched the URL through `/feed` five minutes before the poll
- **THEN** the poll SHALL be served from the shared cache without an upstream request

### Requirement: Poll database storage guard

Each run SHALL read the poll database size. When it exceeds `POLL_DB_MAX_BYTES` (default 8 GiB), the run SHALL NOT fetch any feed and SHALL log that storage is full. Maintenance SHALL continue.

#### Scenario: Database full
- **WHEN** the poll database is larger than `POLL_DB_MAX_BYTES`
- **THEN** the run SHALL make no upstream request

### Requirement: Retain new items per feed URL for seven days

The server SHALL parse polled bodies with the client's feed parser and insert each entry, up to 100 per body, keyed by feed URL and guid, without updating existing rows. Each row SHALL carry an increasing insertion sequence, title, link, author, published time (null when unusable), excerpt, thumbnail URL, feed HTML when its UTF-8 size is at most 64 KiB (otherwise null), and first-seen time. Rows SHALL NOT contain a sync key. Items first seen more than 7 days earlier SHALL be deleted by maintenance.

#### Scenario: Entry already stored
- **WHEN** a poll parses an entry whose guid is already stored for the URL
- **THEN** the stored row and its sequence SHALL be unchanged

#### Scenario: Large feed HTML
- **WHEN** an entry's feed HTML exceeds 64 KiB
- **THEN** the item SHALL be stored without HTML

### Requirement: Paginated items pull

`GET /sync/items?after=<seq>` SHALL accept the same credentials as `/sync/pull`, apply its own per-key rate limit and send `Cache-Control: no-store`. It SHALL return up to 200 items with a sequence greater than `after` that belong to the caller's live subscriptions (limited to the 500 with the lowest feed IDs), each with the caller's `feed_id` and without the feed URL, ordered by sequence, together with `cursor` and `more`. When the page is full, `cursor` SHALL be the last returned sequence and `more` SHALL be true. Otherwise `cursor` SHALL be the highest sequence that existed when the request started and `more` SHALL be false. An item SHALL appear once per page even when the caller has several live feed rows with its URL.

#### Scenario: Items for other accounts' feeds
- **WHEN** new items exist only for feeds the caller does not subscribe to
- **THEN** the response SHALL contain no items
- **AND** `cursor` SHALL advance past them

#### Scenario: Invalid cursor
- **WHEN** `after` is negative or not a number
- **THEN** the server SHALL return `400`

### Requirement: Clients fill gaps from server items

When the server reports `items: true`, the client SHALL pull item pages after each successful sync pull and after first-time setup, until `more` is false or 50 pages have been read, and SHALL persist the cursor locally. The cursor SHALL be cleared whenever the sync cursor is cleared. The client SHALL insert only items it does not already store, for feeds it has locally, preserving synced read and starred flags. When the server's published time is null the item SHALL use the server's first-seen time and be marked as date fallback. The client SHALL queue feed statistics for affected feeds and refresh the visible lists when items were inserted. A failed item pull SHALL NOT fail the sync pull or first-time setup; the next pull resumes from the stored cursor.

#### Scenario: Item missed while offline
- **WHEN** a feed published an item and dropped it from its body while no device was open
- **AND** the server polled the feed in between
- **THEN** the next sync pull on any device SHALL insert that item

#### Scenario: Browser copy already present
- **WHEN** a server item has the same ID as a locally stored item
- **THEN** the local item SHALL be unchanged

#### Scenario: Item already read on another device
- **WHEN** a server item arrives for which a synced read flag exists
- **THEN** the inserted item SHALL be read

#### Scenario: Item pull fails during first-time setup
- **WHEN** `/sync/items` returns `500` while a device enables sync
- **THEN** sync SHALL remain enabled
- **AND** the next sync pull SHALL request items again

#### Scenario: Server without item sync
- **WHEN** `/sync/capabilities` does not report `items: true`
- **THEN** the client SHALL NOT request `/sync/items`

### Requirement: Account deletion removes unshared polling state

When polling is enabled and an account is deleted through `DELETE /sync/account`, the server SHALL, after deleting the account, remove from the poll database every URL the account subscribed to (live or tombstoned) that no other live subscription in the sync database references, together with its `polled_feeds` row and its `polled_items` rows. A URL that another account still subscribes to SHALL keep its registry row and items. Failure of this step SHALL NOT fail the deletion; the daily maintenance pass, which rebuilds the registry from accounts that exist, are not rotated and have pulled within 14 days, SHALL then remove the URLs.

Accounts deleted by the daily retention cron SHALL NOT need this step: an account inactive for 365 days or rotated away has been outside the registry's 14-day window or rotated since before it was deleted, so its URLs have already left the registry and its items have already expired. Items of a URL removed by maintenance expire after 7 days as before.

#### Scenario: Feeds only the deleted account followed
- **WHEN** an account that was the only subscriber to a URL, including a private-feed URL with an embedded token, is deleted
- **THEN** the URL's `polled_feeds` and `polled_items` rows SHALL be deleted immediately

#### Scenario: Shared subscription
- **WHEN** an account is deleted and another account still has a live feed with the same URL
- **THEN** the registry row and items for that URL SHALL remain

#### Scenario: Other account's tombstone
- **WHEN** the only other row for a URL is a tombstoned feed of another account
- **THEN** the URL SHALL be removed with the deleted account's

#### Scenario: Immediate removal fails
- **WHEN** the poll database cannot be updated during an account deletion
- **THEN** the deletion SHALL still return `204`
- **AND** the next maintenance pass SHALL remove the URLs that no remaining account wants

#### Scenario: Poll database not bound
- **WHEN** polling is disabled for the deployment
- **THEN** account deletion SHALL NOT touch any poll database
