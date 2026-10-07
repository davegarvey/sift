# item-body-storage Specification Delta

## MODIFIED Requirements

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
