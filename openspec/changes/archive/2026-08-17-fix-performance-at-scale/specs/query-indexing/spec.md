## ADDED Requirements

### Requirement: Unread items are queried via an indexed lookup
`listUnreadAcrossFeeds()` SHALL use an IndexedDB index on the `read` field (stored as a number: 0 for unread, 1 for read) instead of scanning the `by-feed-published` index and filtering in JavaScript. When the `read` field is not indexable directly (IDB limitation with booleans), a secondary object store or a numeric key SHALL be used.

#### Scenario: Unread query returns items quickly with many read items
- **WHEN** the database contains 50,000 items of which 200 are unread
- **THEN** `listUnreadAcrossFeeds(200)` SHALL return results after iterating only the unread items (or near-O(unread_count) index entries), not scanning all 50,000 items

#### Scenario: Unread query respects the read flag change
- **WHEN** an item is marked read via `markRead()`
- **THEN** subsequent `listUnreadAcrossFeeds()` queries SHALL NOT include that item

### Requirement: Starred items are queried via an indexed lookup
`listStarred()` SHALL use an IndexedDB index on the `starred` field (stored as a number: 0 for unstarred, 1 for starred) instead of scanning the full index and filtering in JavaScript.

#### Scenario: Starred query returns items efficiently
- **WHEN** the database contains 50,000 items of which 50 are starred
- **THEN** `listStarred(200)` SHALL return results after iterating only the starred items (or near-O(starred_count) index entries)

#### Scenario: Starred query respects the star toggle
- **WHEN** an item is unstarred via `toggleStar()`
- **THEN** subsequent `listStarred()` queries SHALL NOT include that item

### Requirement: Results from indexed queries are sorted by publishedAt descending
The `by-read` and `by-starred` indexes sort by flag value then primary key, not by `publishedAt`. Query results SHALL be sorted in memory by `publishedAt` descending (newest-first) before being returned to the UI. The sort is bounded to at most 200 items, so the cost is negligible.

#### Scenario: Unread results are ordered newest-first
- **WHEN** `listUnreadAcrossFeeds(200)` returns items
- **THEN** the results SHALL be sorted by `publishedAt` descending

#### Scenario: Starred results are ordered newest-first
- **WHEN** `listStarred(200)` returns items
- **THEN** the results SHALL be sorted by `publishedAt` descending

### Requirement: Flag mutations keep the index in sync
When an item's `read` or `starred` field changes, the corresponding index or secondary store SHALL be updated atomically within the same transaction as the primary item update.

#### Scenario: Marking read updates both primary and flag index
- **WHEN** `markRead(id, true)` is called
- **THEN** the item's `read` field SHALL be set to true in the items store AND the flag index SHALL reflect the change in a single transaction

#### Scenario: Deleting items by feed cleans up flag entries
- **WHEN** `deleteItemsByFeed(feedUrl)` removes items
- **THEN** the corresponding flag index entries for those items SHALL also be removed

### Requirement: Backfill completes before indexed queries are used
The v2-to-v3 migration that populates the `itemFlags` store from existing items SHALL run to completion before `listUnreadAcrossFeeds` and `listStarred` switch to indexed queries. Completion SHALL be tracked via a `meta` record (key: `flagsBackfilled`). Until the flag reads `true`, the query functions SHALL fall back to the original full-scan approach.

#### Scenario: Queries fall back during backfill
- **WHEN** the migration has not yet completed (`flagsBackfilled` is absent or `false`)
- **THEN** `listUnreadAcrossFeeds()` and `listStarred()` SHALL use the original full-scan implementation

#### Scenario: Queries use indexes after backfill
- **WHEN** `flagsBackfilled` is `true`
- **THEN** `listUnreadAcrossFeeds()` and `listStarred()` SHALL use the indexed `itemFlags` store
