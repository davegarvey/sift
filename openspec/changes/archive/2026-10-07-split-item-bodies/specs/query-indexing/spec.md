## MODIFIED Requirements

### Requirement: Unread items are queried via an indexed lookup
`listUnreadAcrossFeeds()` SHALL use an IndexedDB index on the `read` field (stored as a number: 0 for unread, 1 for read) instead of scanning the `by-feed-published` index and filtering in JavaScript. When the `read` field is not indexable directly (IDB limitation with booleans), a secondary object store or a numeric key SHALL be used. It SHALL read article records only, which contain no `html` or `extractedHtml`.

#### Scenario: Unread query returns items quickly with many read items
- **WHEN** the database contains 50,000 items of which 200 are unread
- **THEN** `listUnreadAcrossFeeds(200)` SHALL return results after iterating only the unread items (or near-O(unread_count) index entries), not scanning all 50,000 items

#### Scenario: Unread query respects the read flag change
- **WHEN** an item is marked read via `markRead()`
- **THEN** subsequent `listUnreadAcrossFeeds()` queries SHALL NOT include that item

#### Scenario: Unread query returns no bodies
- **WHEN** `listUnreadAcrossFeeds()` returns articles that have stored bodies
- **THEN** the returned records SHALL contain neither `html` nor `extractedHtml`

### Requirement: Starred items are queried via an indexed lookup
`listStarred()` SHALL use an IndexedDB index on the `starred` field (stored as a number: 0 for unstarred, 1 for starred) instead of scanning the full index and filtering in JavaScript. It SHALL read article records only, which contain no `html` or `extractedHtml`.

#### Scenario: Starred query returns items efficiently
- **WHEN** the database contains 50,000 items of which 50 are starred
- **THEN** `listStarred(200)` SHALL return results after iterating only the starred items (or near-O(starred_count) index entries)

#### Scenario: Starred query respects the star toggle
- **WHEN** an item is unstarred via `toggleStar()`
- **THEN** subsequent `listStarred()` queries SHALL NOT include that item

#### Scenario: Starred query returns no bodies
- **WHEN** `listStarred()` returns articles that have stored bodies
- **THEN** the returned records SHALL contain neither `html` nor `extractedHtml`

### Requirement: Flag mutations keep the index in sync
When an item's `read` or `starred` field changes, the corresponding index or secondary store SHALL be updated atomically within the same transaction as the primary item update.

#### Scenario: Marking read updates both primary and flag index
- **WHEN** `markRead(id, true)` is called
- **THEN** the item's `read` field SHALL be set to true in the items store AND the flag index SHALL reflect the change in a single transaction

#### Scenario: Deleting items by feed cleans up flag entries
- **WHEN** `deleteItemsByFeed(feedUrl)` removes items
- **THEN** the corresponding flag index entries for those items SHALL also be removed

#### Scenario: Deleting items by feed cleans up bodies
- **WHEN** `deleteItemsByFeed(feedId)` removes items
- **THEN** the corresponding `itemBodies` records SHALL also be removed

## REMOVED Requirements

### Requirement: Backfill completes before indexed queries are used
**Reason**: The version 10 baseline removes the accumulated upgrade steps, including the version 3 backfill of `itemFlags`, and the `flagsBackfilled` meta record was already dropped in version 7. Queries read the `itemFlags` store directly with no full-scan fallback.
**Migration**: None. A database older than version 9 is reset, and a version 9 database already has its flags populated.
