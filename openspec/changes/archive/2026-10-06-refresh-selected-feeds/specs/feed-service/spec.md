## MODIFIED Requirements

### Requirement: OPML import uses the service

`src/opml/merge.ts` SHALL use `subscribeFeed` from the service layer for each new subscription rather than calling `upsertFeed` directly. This ensures OPML-imported feeds are enqueued for sync. The merge operation SHALL return the IDs of newly imported feeds, and the OPML import flow SHALL explicitly refresh every returned feed regardless of the current feed or tag selection.

#### Scenario: OPML import enqueues each new feed
- **WHEN** `applyMerge(preview)` is called with a preview containing multiple new subscriptions
- **THEN** each new subscription is written to local IDB
- **AND** a `feed-upsert` entry is enqueued for each new subscription
- **AND** the operation returns the newly created feed IDs

#### Scenario: OPML import refreshes returned IDs
- **WHEN** the settings import flow applies a preview with multiple new subscriptions
- **THEN** every returned imported feed ID SHALL be explicitly force-refreshed once
- **AND** the explicit import refresh SHALL not require a sync pull that could replace the import target before its first fetch

#### Scenario: OPML import with no new subscriptions
- **WHEN** `applyMerge(preview)` is called with no new subscriptions
- **THEN** no feed is fetched solely because of the import
- **AND** the import flow SHALL not start a refresh operation
