## ADDED Requirements

### Requirement: Manual refresh pulls remote sync state

When the user triggers a manual refresh of all feeds, the client SHALL first pull remote state from the sync server (if sync is configured) before refreshing local feeds from upstream.

#### Scenario: Synced client refreshes after another device added a feed

- **WHEN** Client A adds a feed via subscribe
- **AND** Client B clicks "Refresh all" (sidebar button, `r` key, command palette, or "Check for new items" link)
- **THEN** Client B pulls remote state from `GET /sync/pull?since=<lastSyncAt>` before refreshing local feeds
- **AND** Client B's feed list includes the feed added by Client A after the refresh completes

#### Scenario: Non-synced client refreshes

- **WHEN** the user has not configured a sync key
- **AND** the user clicks "Refresh all"
- **THEN** the sync pull is a no-op (returns early)
- **AND** the refresh proceeds with local feeds only, identical to current behavior

#### Scenario: Sync server is unreachable

- **WHEN** sync is configured
- **AND** the sync server returns an error or is unreachable during the pull
- **THEN** the error is caught internally
- **AND** the refresh proceeds with local feeds only
- **AND** no error is surfaced to the user for the sync failure
