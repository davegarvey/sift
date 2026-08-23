## MODIFIED Requirements

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
