## ADDED Requirements

### Requirement: Scheduler callback triggers UI refresh

The scheduler SHALL fire a callback after `refreshStaleFeeds()` completes and processed at least one stale feed, and the UI SHALL reload feeds and items if the user is active.

#### Scenario: Scheduler fetches new RSS items while user is active
- **WHEN** the background scheduler fetches new items from at least one upstream RSS feed
- **AND** the user is not idle (`isIdle()` returns `false`)
- **THEN** the system SHALL call `reloadFeeds()` and `reloadItems()` to update the UI

#### Scenario: Scheduler fetches new items while user is idle
- **WHEN** the background scheduler fetches new items from at least one upstream RSS feed
- **AND** the user is idle (`isIdle()` returns `true`)
- **THEN** no UI reload SHALL occur
- **AND** the items SHALL remain in IndexedDB for the next UI reload

#### Scenario: Scheduler tick with no stale feeds
- **WHEN** the 5-minute scheduler tick fires and no feeds are stale
- **THEN** the callback SHALL NOT fire (no UI reload)

### Requirement: Sync callback triggers UI refresh

The sync system SHALL fire a callback after `runPull()` or `mergeForFirstTime()` applies new remote data, and the UI SHALL reload feeds and items if the user is active.

#### Scenario: Sync pull returns new data while user is active
- **WHEN** a sync pull (`runPull()`) returns new feeds or flags
- **AND** the user is not idle
- **THEN** the system SHALL call `reloadFeeds()` and `reloadItems()`

#### Scenario: Sync pull returns no new data
- **WHEN** a sync pull (`runPull()`) returns no new feeds or flags (early return at line 122)
- **THEN** the callback SHALL NOT fire

#### Scenario: First-time sync setup
- **WHEN** `mergeForFirstTime()` completes (joining a sync or first-time setup)
- **THEN** the system SHALL call `reloadFeeds()` and `reloadItems()` regardless of idle state

### Requirement: Manual refresh suppresses callbacks

The `refreshAll()` function SHALL suppress scheduler and sync callbacks to prevent redundant reloads.

#### Scenario: User clicks "Refresh all"
- **WHEN** the user clicks the Refresh button or "Check for new items"
- **THEN** the scheduler and sync callbacks SHALL be temporarily suppressed
- **AND** `refreshAll()` SHALL call `pullNow()`, `refreshStaleFeeds(true)`, `reloadFeeds()`, and `reloadItems()` exactly once each

### Requirement: `reloadItems()` SHALL be re-entrant safe

The `reloadItems()` function SHALL guard against concurrent calls: if a reload is already in flight, subsequent calls SHALL be skipped.

#### Scenario: Multiple triggers race
- **WHEN** `reloadItems()` is called while another `reloadItems()` call is in progress
- **THEN** the subsequent call SHALL be a no-op
- **AND** the in-flight call SHALL resolve with the latest IDB state when it completes
