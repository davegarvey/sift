## ADDED Requirements

### Requirement: Per-feed item queries

When a user selects a specific feed, the system SHALL query that feed's items directly from IndexedDB using the feed URL rather than filtering a global in-memory pool.

#### Scenario: Selecting a feed shows its items only
- **WHEN** the user clicks a feed in the sidebar
- **THEN** the system queries items for that feed's URL using `listItemsByFeed(feedUrl, limit)`
- **AND** items from other feeds are excluded from the result set

#### Scenario: Adding a feed with many items does not empty existing feeds
- **WHEN** the user subscribes to a feed that has more than 500 items
- **AND** the user then clicks an existing feed in the sidebar
- **THEN** all of the existing feed's items (up to the query limit) are displayed correctly
- **AND** none are missing due to the new feed consuming the global query pool

### Requirement: Chronological interleaving in All Feeds view

When the user views "All Feeds", the system SHALL return items in true chronological order (most recent first) interleaved across all feeds, using a dedicated `by-published` IndexedDB index.

#### Scenario: All Feeds view interleaves items by published date
- **WHEN** the "All Feeds" view is active
- **THEN** items are ordered by `publishedAt` descending regardless of their source feed
- **AND** items from different feeds are interleaved chronologically in the result set

#### Scenario: Global result set is capped to the latest 500 items
- **WHEN** the total number of stored items exceeds 500
- **THEN** only the 500 most recently published items are returned
- **AND** those 500 items are the chronologically latest items across all feeds (not grouped by feed)

### Requirement: Storage eviction runs after feed refresh

The system SHALL call the storage eviction policy after each feed refresh sweep to prevent unbounded accumulation of cached article extraction data.

#### Scenario: Eviction runs after refresh sweep completes
- **WHEN** a feed refresh sweep (`refreshStaleFeeds`) finishes
- **THEN** `runEviction()` is called to purge old extracted HTML per the configured retention policy
- **AND** the eviction is non-blocking — the next refresh tick is not delayed by eviction
