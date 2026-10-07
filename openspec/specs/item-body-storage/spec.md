# item-body-storage Specification

## Purpose
Define how article bodies are stored, migrated and read separately from metadata so list, search and refresh paths avoid loading large body fields.

## Requirements

### Requirement: Article bodies are stored apart from article records
The database SHALL have an `itemBodies` object store keyed by article ID, holding `{ id, feedId, html?, extractedHtml? }` and indexed by `feedId` as `by-feed-id`. The `Item` type and records in `items` SHALL NOT contain `html` or `extractedHtml`. A body record SHALL exist only when `html` or `extractedHtml` has a value. Retention MAY delete a body's record independently while keeping its item record.

#### Scenario: Bodies are absent from article records
- **WHEN** an article with feed HTML is stored
- **THEN** its record in `items` SHALL have neither `html` nor `extractedHtml`
- **AND** its `itemBodies` record SHALL hold the HTML under the same ID with the article's `feedId`

#### Scenario: Article without feed HTML has no body record
- **WHEN** an article without feed HTML is stored and has never been extracted
- **THEN** `itemBodies` SHALL hold no record for it

#### Scenario: Expired body is removed independently
- **WHEN** an unstarred item's body reaches the configured retention age
- **THEN** its `itemBodies` record SHALL be deleted
- **AND** its article metadata and flags SHALL remain unless the unread-record retention age is also reached

### Requirement: Version 10 is the schema baseline
`DB_VERSION` SHALL be 11. The upgrade handler SHALL create the version 11 layout directly for a new database, migrate a version 10 database in place by adding the `items.by-last-seen` index and stamping existing items with the migration time, and retain the version 9 body-splitting path while stamping its items. It SHALL delete every object store and recreate the version 11 layout, empty, for a database older than version 9. The handler SHALL NOT contain upgrade steps for versions 2 to 8, and code outside the upgrade handler SHALL read only the current layout.

#### Scenario: New database
- **WHEN** a new database is opened
- **THEN** it SHALL be created at version 11 with the stores `feeds`, `items`, `itemBodies`, `itemFlags`, `meta`, `feedStats` and `readMarkers`
- **AND** `items` SHALL have a `by-last-seen` index

#### Scenario: Version 9 database
- **WHEN** a version 9 database is opened
- **THEN** it SHALL be upgraded to version 11 with an empty `itemBodies` store and no `html` or `extractedHtml` on any article record
- **AND** every item SHALL receive `lastSeenAt`
- **AND** article flags, read markers, feed statistics and settings SHALL be unchanged

#### Scenario: Version 10 database
- **WHEN** a version 10 database is opened
- **THEN** its existing stores and records SHALL remain
- **AND** each existing item SHALL receive `lastSeenAt` and the new index SHALL be present

#### Scenario: Database older than version 9
- **WHEN** a database at any version from 1 to 8 is opened
- **THEN** every object store SHALL be deleted and the version 11 layout SHALL be created empty

### Requirement: The version 9 upgrade drops bodies within one transaction
The upgrade SHALL run inside the version-change transaction and SHALL walk `items` with a cursor, holding at most one article record at a time rather than loading the library into memory. For each record with `html` or `extractedHtml` it SHALL rewrite the article record without those fields. It SHALL NOT write any record to `itemBodies`, because reading every stored body to copy it takes about 2.5 times as long as stripping it (75.5 s against 29.7 s on a library of 30,000 articles). If the upgrade fails, the transaction SHALL abort and the database SHALL remain at version 9.

#### Scenario: Bodies are dropped and records are stripped
- **WHEN** a version 9 article has `html` and `extractedHtml`
- **THEN** after the upgrade its `items` record SHALL hold neither
- **AND** `itemBodies` SHALL hold no record for it

#### Scenario: Article without bodies
- **WHEN** a version 9 article has no `html` and a null `extractedHtml`
- **THEN** after the upgrade its article record SHALL be otherwise unchanged

#### Scenario: Failed upgrade
- **WHEN** the upgrade throws
- **THEN** the transaction SHALL abort and reopening at version 9 SHALL find every article record unchanged, bodies included

### Requirement: Dropped bodies are recovered on refresh or first open
An article without a body record SHALL be handled as any article without a body. A fetched entry with feed HTML SHALL write a body for an article that is still in its feed. `openItemForReading` SHALL extract any other article from its link and store the extraction. When extraction fails, it SHALL return the article's excerpt and report the failure.

#### Scenario: Refresh restores feed HTML
- **WHEN** a feed refresh includes an article upgraded from version 9 and the entry has feed HTML
- **THEN** the article SHALL have a body record holding that HTML

#### Scenario: First open extracts again
- **WHEN** an article upgraded from version 9 with no body is opened and extraction succeeds
- **THEN** the extraction SHALL be stored in `itemBodies` and returned for display

#### Scenario: First open offline
- **WHEN** an article upgraded from version 9 with no body is opened and extraction fails
- **THEN** the excerpt SHALL be returned and the failure reported

### Requirement: The upgrade shows a loading message and no other interface
While the database upgrade of an existing database runs, the river's loading message SHALL read "Updating your library…". The app SHALL NOT show a modal or progress indicator for the upgrade. The message SHALL be removed when the database open settles, whether it succeeds or fails. Creating a new database SHALL NOT change the loading message.

#### Scenario: Upgrade during boot
- **WHEN** an existing database is being upgraded at boot
- **THEN** the river SHALL show "Updating your library…" and no other upgrade interface
- **AND** the normal loading message SHALL return once the database opens

#### Scenario: New database
- **WHEN** the database does not exist at boot
- **THEN** the loading message SHALL NOT change to the upgrade message

### Requirement: Tabs release the database for upgrades
When a connection receives a `versionchange` request from a newer version, the `blocking` handler SHALL close the connection and reload the page. When an open request waits on connections in other tabs, the `blocked` handler SHALL change the river's loading message to ask the reader to close other Sift tabs. The blocked message SHALL take precedence over the upgrade message, and the upgrade message SHALL replace it once the upgrade starts.

#### Scenario: A newer version needs this tab's connection
- **WHEN** another tab requests a newer database version while this tab holds an open connection
- **THEN** this tab SHALL close its connection and reload the page

#### Scenario: Upgrade is blocked by another tab
- **WHEN** the database open is blocked by connections in other tabs that have no `blocking` handler
- **THEN** the loading message SHALL ask the reader to close other Sift tabs
- **AND** the message SHALL change to the upgrade message once the other tabs close and the upgrade starts, and to the normal loading message once the open completes

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
