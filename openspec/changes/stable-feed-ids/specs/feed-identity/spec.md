## ADDED Requirements

### Requirement: Feed has stable UUID primary key
Every feed SHALL have a stable `id` field generated at subscribe time using `crypto.randomUUID()`. The `id` SHALL be the IndexedDB primary key. The `url` field SHALL be a regular mutable field — never used as a key or identity.

#### Scenario: Subscribe generates UUID
- **WHEN** a user subscribes to a new feed
- **THEN** the feed record SHALL contain an `id` field with a UUIDv4 string
- **AND** the `id` SHALL be the IndexedDB key for the feeds store

#### Scenario: Feed URL changes without affecting identity
- **WHEN** a user edits a feed's URL
- **THEN** the feed's `id` SHALL remain unchanged
- **AND** all items belonging to the feed SHALL retain their existing IDs

### Requirement: Item IDs use feed ID
Every item's `id` field SHALL be `${feedId}::${guid}` (was `${feedUrl}::${guid}`). Every item's `feedId` field SHALL reference the parent feed's `id`.

#### Scenario: Item created after subscribe
- **WHEN** a feed is refreshed and new items are parsed
- **THEN** each item's `id` SHALL be `${feed.id}::${parsed.guid}`
- **AND** each item's `feedId` SHALL be set to the feed's `id`

#### Scenario: Item flags reference feed ID
- **WHEN** a flag is created or updated for an item
- **THEN** the flag record SHALL contain a `feedId` field matching the item's feed ID

### Requirement: IDB migration preserves read/starred state
The v4→v5 IndexedDB migration SHALL preserve all existing data: feed metadata, items, and read/starred flags. The migration SHALL run atomically — failure SHALL roll back with no data loss.

#### Scenario: Existing data is migrated
- **WHEN** the app loads with a v4 IndexedDB database
- **THEN** all feeds SHALL be assigned UUIDs
- **AND** all items SHALL be re-keyed to use `${feedId}::${guid}`
- **AND** all flags SHALL be re-keyed to match the new item IDs
- **AND** all `feedUrl` references in items and flags SHALL be replaced with `feedId`

#### Scenario: Migration crash is recoverable
- **WHEN** the upgrade callback throws during migration
- **THEN** IndexedDB SHALL roll back to the previous schema version
- **AND** the app SHALL retry migration on next load

### Requirement: Sync protocol uses feed ID as identity
The sync push/pull protocol SHALL use `feedId` / `feed_id` as the stable feed identifier. `feedUrl` / `feed_url` SHALL become optional mutable fields with per-field timestamps.

#### Scenario: Push uses feedId
- **WHEN** the client pushes a feed-upsert entry
- **THEN** the wire payload SHALL contain `feedId` as the identifier
- **AND** `feedUrl` SHALL be omitted or included as `{ value, at }` when the URL changed

#### Scenario: Pull returns feedId
- **WHEN** the server responds to a pull request
- **THEN** each feed in the response SHALL have `feed_id` as the identifier
- **AND** `feed_url`, `feed_url_at` SHALL be included if set

#### Scenario: Flag references feedId
- **WHEN** the client pushes a flag-update entry
- **THEN** the wire payload SHALL contain `feedId` instead of `feedUrl`
- **AND** the item ID SHALL use `encodeURIComponent(feedId)::guid` format

### Requirement: Server D1 schema uses feed_id
The server D1 `feeds` table SHALL use `(sync_key, feed_id)` as the primary key. The `url` field SHALL be stored as `feed_url` with a `feed_url_at` timestamp. The `flags` table SHALL use `feed_id` instead of `feed_url`.

#### Scenario: Server migration drops old tables
- **WHEN** the server starts with a v1 schema
- **THEN** old `feeds` and `flags` tables SHALL be dropped
- **AND** new tables with the `feed_id` schema SHALL be created

### Requirement: Scheduler uses feed ID for state tracking
The scheduler SHALL track fetching state and error state by `feed.id`, not `feed.url`.

#### Scenario: Feed fetch error is tracked by ID
- **WHEN** a feed refresh fails
- **THEN** the error SHALL be stored and surfaced by the feed's `id`
