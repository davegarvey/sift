# server-feed-polling Specification Delta

## MODIFIED Requirements

### Requirement: Polling is opt-in per deployment
The Worker SHALL poll feeds and serve item sync only when its `FEED_POLLING` variable is `"true"` and a poll database is bound as `POLL_DB`. Node and Bun SHALL poll only when `SIFT_DATA_DIR` is configured and `FEED_POLLING=true`, using the separate local poll database. Polling state and items SHALL be stored in the poll database, not the sync database. `/sync/capabilities` SHALL report `items: true` only when polling is enabled and the poll database is available.

#### Scenario: Polling disabled
- **WHEN** `FEED_POLLING` is unset
- **THEN** the scheduled handler SHALL NOT fetch any feed
- **AND** `/sync/capabilities` SHALL NOT report `items: true`
- **AND** `GET /sync/items` SHALL return `404`

#### Scenario: Poll database missing
- **WHEN** `FEED_POLLING` is `"true"` and no `POLL_DB` binding exists
- **THEN** polling and item sync SHALL be disabled

#### Scenario: Polling on Node or Bun
- **WHEN** Node or Bun starts with `SIFT_DATA_DIR` configured and `FEED_POLLING=true`
- **THEN** it SHALL use `sift-poll.sqlite` separately from `sift-sync.sqlite`
- **AND** it SHALL check for due feeds every 10 minutes
- **AND** `/sync/capabilities` SHALL report `items: true`
