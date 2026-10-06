# event-driven-refresh Specification

## Purpose
TBD - created by archiving change smart-refresh-strategy. Update Purpose after archive.

## Requirements

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

The manual refresh operation SHALL suppress scheduler and sync callbacks to prevent redundant reloads. It SHALL snapshot the concrete feed IDs in the selection when the action begins, refresh only those feeds, and preserve the existing sync pull and final UI reload behavior. Repeated manual actions received while one is running SHALL be coalesced rather than starting a second concurrent manual refresh.

#### Scenario: User clicks "Refresh all"
- **WHEN** the user activates the Refresh button or "Check for new items" while All is selected
- **THEN** the scheduler and sync callbacks SHALL be temporarily suppressed
- **AND** the system SHALL pull remote sync state once
- **AND** every feed subscribed when the action began SHALL be force-refreshed once
- **AND** feeds added by the sync pull after the action began SHALL not be fetched by that action
- **AND** the feeds and items SHALL each be reloaded once after the refresh completes

#### Scenario: User manually refreshes one feed
- **WHEN** the user activates a manual refresh while a single feed is selected
- **THEN** only that selected feed SHALL be force-refreshed
- **AND** feeds outside the selection SHALL not be fetched by that action
- **AND** the feeds and items SHALL each be reloaded once after the refresh completes

#### Scenario: User manually refreshes a tag selection
- **WHEN** the user activates a manual refresh while one or more tags are selected
- **THEN** every feed matching at least one selected tag SHALL be force-refreshed
- **AND** feeds matching none of the selected tags SHALL not be fetched by that action
- **AND** multiple selected tags SHALL use the existing OR semantics

#### Scenario: Repeated manual refresh actions
- **WHEN** the user presses `r` or activates a refresh control while another manual refresh is running
- **THEN** the existing manual refresh SHALL continue
- **AND** a second concurrent manual refresh SHALL not start

#### Scenario: Manual refresh recovers from a fetch error
- **WHEN** a targeted feed refresh rejects due to an unexpected fetch or storage error
- **THEN** the feeds and items reloads SHALL still be attempted
- **AND** the manual in-flight state SHALL be cleared after those reload attempts

#### Scenario: Active selection matches no feeds
- **WHEN** a manual refresh begins with an active feed or tag selection that resolves to no subscribed feeds
- **THEN** no upstream feed SHALL be fetched
- **AND** the normal final feeds and items reloads SHALL still occur

### Requirement: `reloadItems()` SHALL be re-entrant safe

The `reloadItems()` function SHALL guard against concurrent calls: if a reload is already in flight, subsequent calls SHALL be skipped.

#### Scenario: Multiple triggers race
- **WHEN** `reloadItems()` is called while another `reloadItems()` call is in progress
- **THEN** the subsequent call SHALL be a no-op
- **AND** the in-flight call SHALL resolve with the latest IDB state when it completes
