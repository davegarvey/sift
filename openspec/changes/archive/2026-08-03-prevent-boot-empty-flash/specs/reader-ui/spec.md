## MODIFIED Requirements

### Requirement: Empty state is shown without hiding the app

When no items match the current view, the river SHALL display a contextual empty state OR a loading state. The loading state takes priority when a feed fetch is in progress OR while the app is hydrating feeds/items from IndexedDB on startup. The app SHALL NOT hide navigation or chrome in any empty or loading state.

#### Scenario: Feed being fetched — loading state shown

- **GIVEN** a feed that has been subscribed to but not yet fetched (no items in IndexedDB for that feed)
- **WHEN** the feed fetch is in progress
- **THEN** the river SHALL display 5–6 shimmer skeleton placeholder cards matching the river-item layout instead of an empty state

#### Scenario: Fetch completes — items replace skeleton

- **GIVEN** the skeleton loading state is displayed
- **WHEN** the feed fetch completes and items are stored
- **THEN** the skeleton SHALL be replaced by the fetched items within the same rendering frame that items are loaded into the reactive state

#### Scenario: Zero items in All mode (fresh install, no fetch in progress)

- **WHEN** the user is in "All" mode and IndexedDB contains no items
- **AND** no feed fetch is in progress
- **AND** the app has finished hydrating from IndexedDB
- **THEN** the river body shows an empty state describing that no feeds are subscribed (unchanged)

## ADDED Requirements

### Requirement: Startup hydration is not presented as an empty state

While the app is hydrating feeds and items from IndexedDB on startup, the river SHALL display the loading state instead of any empty state. Empty states SHALL be shown only after hydration completes. Hydration SHALL be considered complete even when the IndexedDB read fails, so the loading state SHALL NOT persist indefinitely.

#### Scenario: Startup with existing data

- **GIVEN** a returning user whose IndexedDB contains feeds and items
- **WHEN** the app loads
- **THEN** the river SHALL NOT display "Welcome to Sift" or "No items yet." before the stored items are rendered
- **AND** the loading state SHALL be replaced by the stored items within the same rendering frame that items are loaded into the reactive state

#### Scenario: Startup with a genuinely empty database (first run)

- **GIVEN** a fresh install with no feeds and no items in IndexedDB
- **WHEN** hydration completes
- **THEN** the river SHALL display the "Welcome to Sift" first-run empty state

#### Scenario: Startup with feeds but no items

- **GIVEN** a database containing feeds but no items
- **AND** no feed fetch is in progress at hydration end
- **WHEN** hydration completes
- **THEN** the river SHALL display the "No items yet." empty state

#### Scenario: Startup with a never-fetched feed (no items, fetch in progress)

- **GIVEN** a database containing a feed with no items that is stale at boot (e.g. a subscription whose initial fetch failed)
- **WHEN** the scheduler's boot-time stale-feed refresh is fetching that feed
- **THEN** the river SHALL display the loading state until the fetch settles
- **AND** if the fetch completes with no items, the "No items yet." empty state SHALL appear (unchanged behavior)

#### Scenario: IndexedDB read fails during hydration

- **GIVEN** an IndexedDB read failure during startup
- **WHEN** the boot sequence finishes (with the read failed)
- **THEN** the loading state SHALL be removed
- **AND** the river SHALL display the appropriate empty state rather than skeletons indefinitely
