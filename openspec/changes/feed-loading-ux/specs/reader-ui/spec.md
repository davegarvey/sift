## MODIFIED Requirements

### Requirement: Empty state is shown without hiding the app

When no items match the current view, the river SHALL display a contextual empty state OR a loading state. The loading state takes priority when a feed fetch is in progress. The app SHALL NOT hide navigation or chrome in any empty or loading state.

#### Scenario: Feed being fetched — loading state shown

- **GIVEN** a feed that has been subscribed to but not yet fetched (no items in IndexedDB for that feed)
- **WHEN** the feed fetch is in progress
- **THEN** the river SHALL display 5–6 shimmer skeleton placeholder cards matching the river-item layout instead of an empty state

#### Scenario: Fetch completes — items replace skeleton

- **GIVEN** the skeleton loading state is displayed
- **WHEN** the feed fetch completes and items are stored
- **THEN** the skeleton SHALL be replaced by the fetched items within the same rendering frame that items are loaded into the reactive state

#### Scenario: No unread items in Unread mode (no fetch in progress)

- **WHEN** the user is in "Unread" mode and IndexedDB contains no unread items
- **AND** no feed fetch is in progress
- **THEN** the river body shows "You're all caught up." and a "Check for new items" link below it (unchanged)

#### Scenario: Zero items in All mode (fresh install, no fetch in progress)

- **WHEN** the user is in "All" mode and IndexedDB contains no items
- **AND** no feed fetch is in progress
- **THEN** the river body shows an empty state describing that no feeds are subscribed (unchanged)

## ADDED Requirements

### Requirement: Per-feed fetching indicator in sidebar

The sidebar SHALL indicate when a specific feed is currently being fetched. A small animated spinner SHALL be displayed next to the feed's title while the fetch is in flight. The spinner SHALL be removed when the fetch completes (whether success or error).

#### Scenario: Feed fetch in progress

- **WHEN** a feed subscription is being fetched
- **THEN** a small rotating spinner icon SHALL appear next to that feed's title in the sidebar

#### Scenario: Feed fetch completes

- **WHEN** the feed fetch completes (success or error)
- **THEN** the spinner SHALL be removed from that feed's sidebar entry

#### Scenario: Multiple feeds being fetched simultaneously

- **WHEN** multiple feeds are being fetched concurrently
- **THEN** each feed SHALL independently display its spinner while its own fetch is in flight

### Requirement: Items appear immediately after subscribe fetch

After a user subscribes to a feed, the items SHALL appear in the river as soon as the initial fetch completes, without waiting for the periodic polling interval.

#### Scenario: User subscribes and fetch succeeds

- **WHEN** the user subscribes to a feed
- **AND** the initial feed fetch completes successfully
- **THEN** the items SHALL be loaded into the river within the same tick as the fetch resolution

#### Scenario: User subscribes and fetch fails

- **WHEN** the user subscribes to a feed
- **AND** the initial feed fetch fails
- **THEN** the loading state SHALL be removed
- **AND** the feed SHALL display its error state in the sidebar
- **AND** the river SHALL show the appropriate empty state (feed has no items and fetch failed)
