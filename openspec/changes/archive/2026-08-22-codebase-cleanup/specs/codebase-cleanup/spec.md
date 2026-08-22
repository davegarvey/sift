## ADDED Requirements

### Requirement: ETag middleware removed from proxy routes
The Hono `etag()` middleware SHALL NOT be mounted on the `/feed`, `/article`, or `/img` proxy routes so that the upstream ETag is passed through to the browser without being overwritten by a body hash.

#### Scenario: Feed request returns upstream ETag
- **WHEN** a client requests `GET /feed?url=...` and the upstream returns 200 with an `ETag` header
- **THEN** the response SHALL include the upstream's `ETag` value (not a body-hash-based ETag)

### Requirement: Cron cleanup uses consistent time units
The daily cron handler SHALL compare pairing code `expires_at` values using the same time unit (seconds) that the pairing code endpoint stores them in.

#### Scenario: Expired pairing codes are deleted
- **WHEN** the cron handler runs and a pairing code's `expires_at` is older than the configured grace period
- **THEN** the pairing code SHALL be deleted

#### Scenario: Valid pairing codes survive cron
- **WHEN** the cron handler runs and a pairing code's `expires_at` is within the configured grace period
- **THEN** the pairing code SHALL NOT be deleted

### Requirement: Dead `by-feed-url` index removed
The `'by-feed-url'` index on the `itemFlags` object store SHALL NOT be created, because its key path `feedUrl` does not exist on the `ItemFlag` type.

#### Scenario: itemFlags store has no by-feed-url index
- **WHEN** the database is opened at version 6 or later
- **THEN** the `itemFlags` object store SHALL NOT have an index named `by-feed-url`

### Requirement: Feeds store has a `by-url` index
The `feeds` object store SHALL have a non-unique index on the `url` field so that `getFeedByUrl` can use indexed lookup instead of a full table scan.

#### Scenario: Feed lookup by URL uses index
- **WHEN** `getFeedByUrl(url)` is called
- **THEN** it SHALL use the `by-url` index instead of scanning all feeds

### Requirement: Proxy responses include Cache-Control
The `/feed` and `/article` proxy endpoints SHALL set `Cache-Control: no-cache, no-store` on their responses to prevent intermediate caching of the proxied content.

#### Scenario: Feed response has no-cache header
- **WHEN** a client requests `GET /feed?url=...`
- **THEN** the response SHALL include `Cache-Control: no-cache, no-store`

### Requirement: Schema initialization uses batch API
`ensureSchema` SHALL use `db.batch()` to execute all DDL statements in a single round-trip instead of awaiting each sequentially.

#### Scenario: Schema tables created in one batch
- **WHEN** `ensureSchema` is called
- **THEN** all CREATE TABLE and CREATE INDEX statements SHALL be submitted as a single batch

### Requirement: Dead code removed from OPML parser
The `parseOpml` function SHALL NOT contain the dead `tokens` array construction, sorting, or unused regex patterns that were superseded by the `sequentialScan` implementation.

#### Scenario: OPML parsing is unaffected
- **WHEN** an OPML document is parsed
- **THEN** the result SHALL be identical before and after the dead code removal

### Requirement: Dead `snapshotFeeds` function removed
The unused `snapshotFeeds()` placeholder function in `sync/merge.ts` SHALL be deleted.

#### Scenario: Build passes after removal
- **WHEN** TypeScript compiles the codebase after removing `snapshotFeeds`
- **THEN** there SHALL be no compilation errors and no remaining references to the function

### Requirement: `settings.ts` inlined
The `settings.ts` module SHALL be deleted and its `getSettings`/`saveSettings` functions SHALL be moved into `state.tsx`, the file's sole consumer.

#### Scenario: Settings load and save unchanged
- **WHEN** the app loads settings
- **THEN** the behavior SHALL be identical to the previous implementation

### Requirement: Duplicate feed ID derivation deduplicated
The `deriveFeedIdFromItemId` function in `server/sync/routes.ts` SHALL be replaced with a call to the shared `decodeItemId` from `sync/itemId.ts`.

#### Scenario: Push endpoint validates feed IDs correctly
- **WHEN** a client pushes a flag payload with a valid `itemId`
- **THEN** the server SHALL correctly derive the `feedId` using the shared utility

### Requirement: Silent catch blocks logged where appropriate
The following catch blocks SHALL include a `console.warn` call: `src/opml/merge.ts:11` (URL normalization failure), `src/articles/service.ts:26` (article link URL resolution failure), `src/server/fetch.ts:12` (URL decode failure). Remaining silent catch blocks SHALL remain silent with documented intent.

#### Scenario: Unexpected URL normalization failure is logged
- **WHEN** `normalizeUrl` in `opml/merge.ts` fails to parse a URL
- **THEN** a `console.warn` SHALL be emitted

### Requirement: Deploy script uses fast-forward only
The `deploy` script in `package.json` SHALL use `git pull --ff-only` instead of bare `git pull` to prevent accidental merge commits.

#### Scenario: Deploy pulls with --ff-only
- **WHEN** the deploy script is invoked
- **THEN** it SHALL run `git pull --ff-only`

### Requirement: Cast annotations added
All `as any` and `as unknown` casts SHALL have a comment explaining why the cast is necessary.

#### Scenario: Every cast has a comment
- **WHEN** inspecting each `as any` or `as unknown` usage
- **THEN** each SHALL have a `// why:` comment on the same line or preceding line

### Requirement: wrangler compatibility_date updated
The `compatibility_date` in `wrangler.toml` SHALL be `2026-01-01`.

#### Scenario: wrangler validates the date
- **WHEN** `wrangler deploy` runs
- **THEN** it SHALL accept `2026-01-01` as a valid compatibility date

### Requirement: Hidden sourcemaps enabled
The Vite build configuration SHALL set `build.sourcemap` to `'hidden'`.

#### Scenario: Source maps exist without inline references
- **WHEN** `npm run build` runs
- **THEN** `.map` files SHALL be generated in the output directory without `//# sourceMappingURL` comments in the JS files

### Requirement: Empty upgrade handler removed
The empty `if (_oldVersion < 4) {}` block in the IndexedDB upgrade handler SHALL be removed.

#### Scenario: Database upgrade completes
- **WHEN** a client's database upgrades from version 3 to a later version
- **THEN** the upgrade SHALL complete without the empty handler

### Requirement: Dirty queue avoids in-place mutation
The dirty queue in `src/sync/queue.ts` SHALL NOT mutate existing entries in-place. New flag-update entries SHALL always be appended; deduplication SHALL happen at push time.

#### Scenario: Concurrent flag updates preserve latest state
- **WHEN** two `enqueueFlag` calls for the same item interleave with a `flushNow`
- **THEN** the last-written value SHALL be pushed to the server

### Requirement: bulkUpsertItems uses batched reads
`bulkUpsertItems` in `src/db/items.ts` SHALL fetch all existing items and flags for the given feed in batch reads before processing, rather than per-item serial IDB gets.

#### Scenario: Bulk upsert performs 2 reads per feed
- **WHEN** `bulkUpsertItems` is called with 500 items for one feed
- **THEN** it SHALL make no more than 2 read operations against the items store and 1 read against the flags store (not 500 per-store)

### Requirement: Swipe gesture uses pointer capture
The swipe handler in `River.tsx` SHALL call `el.setPointerCapture(e.pointerId)` at the start of each gesture so that pointer events track the swiped element even when the pointer leaves its bounds.

#### Scenario: Swipe continues outside element bounds
- **WHEN** a user starts a swipe gesture on an item and drags outside the element
- **THEN** the swipe SHALL continue tracking on the original element

### Requirement: Eviction preserves extracted HTML for never-opened items
The eviction sort SHALL order never-opened items (`firstOpenedAt = null`) after opened items so their extracted HTML is retained longest.

#### Scenario: Never-opened items evicted last
- **WHEN** eviction runs and selects items for `extractedHtml` removal
- **THEN** items with `firstOpenedAt = null` SHALL be processed after all items with a non-null `firstOpenedAt`
