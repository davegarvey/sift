## ADDED Requirements

### Requirement: Article bodies are stored apart from article records
The database SHALL have an `itemBodies` object store keyed by article ID, holding `{ id, feedId, html?, extractedHtml? }` and indexed by `feedId` as `by-feed-id`. The `Item` type and the records in `items` SHALL NOT contain `html` or `extractedHtml`. A body record SHALL exist only when `html` or `extractedHtml` has a value.

#### Scenario: Bodies are absent from article records
- **WHEN** an article with feed HTML is stored
- **THEN** its record in `items` SHALL have neither `html` nor `extractedHtml`
- **AND** its `itemBodies` record SHALL hold the HTML under the same ID with the article's `feedId`

#### Scenario: Article without feed HTML has no body record
- **WHEN** an article without feed HTML is stored and has never been extracted
- **THEN** `itemBodies` SHALL hold no record for it

### Requirement: Version 10 is the schema baseline
`DB_VERSION` SHALL be 10. The upgrade handler SHALL create the version 10 layout directly for a new database, migrate a version 9 database in place, and delete every object store and recreate the version 10 layout, empty, for a database older than version 9. The handler SHALL NOT contain upgrade steps for versions 2 to 9, and code outside the upgrade handler SHALL read only the version 10 layout, with no fallback to bodies on article records.

#### Scenario: New database
- **WHEN** the database does not exist
- **THEN** it SHALL be created at version 10 with the stores `feeds`, `items`, `itemBodies`, `itemFlags`, `meta`, `feedStats` and `readMarkers` and their indexes

#### Scenario: Version 9 database
- **WHEN** a version 9 database is opened
- **THEN** it SHALL be upgraded to version 10 with every body moved to `itemBodies` and article flags, read markers, feed statistics and settings unchanged

#### Scenario: Database older than version 9
- **WHEN** a database at any version from 1 to 8 is opened
- **THEN** every object store SHALL be deleted and the version 10 layout SHALL be created empty

### Requirement: The version 9 migration streams within one transaction
The migration SHALL run inside the version-change transaction and SHALL walk `items` with a cursor, holding at most one article record at a time rather than loading the library into memory. For each record with `html` or `extractedHtml` it SHALL write a body record and rewrite the article record without those fields. If the migration fails, the transaction SHALL abort and the database SHALL remain at version 9.

#### Scenario: Bodies move and records are stripped
- **WHEN** a version 9 article has `html` and `extractedHtml`
- **THEN** after the upgrade its `itemBodies` record SHALL hold both values and its `items` record SHALL hold neither

#### Scenario: Article without bodies
- **WHEN** a version 9 article has no `html` and a null `extractedHtml`
- **THEN** after the upgrade `itemBodies` SHALL hold no record for it and its article record SHALL be otherwise unchanged

### Requirement: The upgrade has no migration interface
The app SHALL NOT show a modal or progress indicator for the upgrade. While the database opens, the app SHALL show its existing loading state.

#### Scenario: Upgrade during boot
- **WHEN** the database upgrade is running at boot
- **THEN** the river SHALL show its existing loading message and no other upgrade interface

### Requirement: Tabs release the database for upgrades
When a connection receives a `versionchange` request from a newer version, the `blocking` handler SHALL close the connection and reload the page. When an open request waits on connections in other tabs, the `blocked` handler SHALL change the river's loading message to ask the reader to close other Sift tabs, and the message SHALL revert when the database opens.

#### Scenario: A newer version needs this tab's connection
- **WHEN** another tab requests a newer database version while this tab holds an open connection
- **THEN** this tab SHALL close its connection and reload the page

#### Scenario: Upgrade is blocked by another tab
- **WHEN** the database open is blocked by connections in other tabs that have no `blocking` handler
- **THEN** the loading message SHALL ask the reader to close other Sift tabs
- **AND** the message SHALL revert to the normal loading message once the open completes

### Requirement: Writes store articles and bodies in one transaction
`bulkUpsertItems` SHALL accept entries that carry `html` and SHALL write article records, flags, statistics and body records in a single transaction, for browser refreshes, the add-feed flow and sync item pulls. A fetched entry with feed HTML SHALL replace the stored `html` and clear any stored `extractedHtml`. A fetched entry without feed HTML SHALL leave the stored body unchanged. With `insertOnly`, an article that already exists SHALL be skipped, including its body.

#### Scenario: New article with feed HTML
- **WHEN** an entry with feed HTML is inserted
- **THEN** its article record and its body record SHALL be committed together

#### Scenario: Refresh with feed HTML replaces the extraction
- **WHEN** a stored article has an `extractedHtml` and a refresh supplies feed HTML for it
- **THEN** the body record SHALL hold the new `html` and no `extractedHtml`

#### Scenario: Refresh without feed HTML keeps the body
- **WHEN** a stored article has a body and a refresh supplies no feed HTML for it
- **THEN** the body record SHALL be unchanged

#### Scenario: Sync pull skips existing articles
- **WHEN** a sync items pull includes an article that is already stored and carries feed HTML
- **THEN** neither the article record nor its body record SHALL change

### Requirement: Only opening an article reads its body
`openItemForReading` SHALL be the only code path that reads `itemBodies` for display. Listing, searching, unread and starred queries, and the merge step of `bulkUpsertItems` SHALL read article records only. `openItemForReading` SHALL read the body by article ID and apply this order: feed HTML unless it is partial content, then a cached extraction, then a new extraction, which SHALL be stored in `itemBodies`. Search SHALL keep substring matching on title and excerpt.

#### Scenario: Lists and search return no bodies
- **WHEN** `listItems`, `listItemsByFeed`, `listSelectedItems`, `listUnreadAcrossFeeds`, `listStarred` or `searchItems` returns articles
- **THEN** the returned records SHALL contain neither `html` nor `extractedHtml`

#### Scenario: Feed HTML is shown
- **WHEN** an opened article has feed HTML that is not partial content
- **THEN** that HTML SHALL be returned for display and no extraction SHALL be requested

#### Scenario: Cached extraction is shown
- **WHEN** an opened article has no usable feed HTML and a stored `extractedHtml`
- **THEN** the stored extraction SHALL be returned and no extraction SHALL be requested

#### Scenario: New extraction is stored in the body store
- **WHEN** an opened article has neither usable feed HTML nor a stored extraction and extraction succeeds
- **THEN** the extraction SHALL be stored as `extractedHtml` in `itemBodies` and returned for display

#### Scenario: Extraction after the article was deleted
- **WHEN** an extraction completes after its article has been deleted
- **THEN** no body record SHALL be created

### Requirement: Bodies are deleted with their articles
Deleting a feed's items SHALL delete the corresponding records in `itemBodies` in the same transaction. Re-keying a feed to a new ID SHALL move its body records to the re-keyed article IDs, with the target's fields taking precedence when a body already exists.

#### Scenario: Unsubscribing removes bodies
- **WHEN** a feed is unsubscribed
- **THEN** no `itemBodies` record with that feed's `feedId` SHALL remain

#### Scenario: Re-keying a feed keeps bodies reachable
- **WHEN** a feed's ID changes from `a` to `b` during sync pairing
- **THEN** the bodies of its articles SHALL be stored under the IDs `b::<guid>` with `feedId` `b`
- **AND** no body SHALL remain under the old IDs

### Requirement: No size-based eviction
The app SHALL NOT clear article bodies based on storage usage. `runEviction`, `STORAGE_SOFT_CAP_RATIO` and `EVICTION_CHUNK_SIZE` SHALL NOT exist, and the scheduler SHALL NOT run an eviction pass after a refresh sweep.

#### Scenario: Refresh sweep does not evict
- **WHEN** a scheduled refresh sweep completes
- **THEN** no body SHALL be removed as a result of the sweep
