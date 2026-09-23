## MODIFIED Requirements

### Requirement: Empty state is shown without hiding the app

When no items match the current view, the river SHALL display a contextual empty state OR a loading state. The loading state takes priority when a visible feed is being fetched or while the app is hydrating feeds/items from IndexedDB on startup. During a feed fetch, the river SHALL display “Fetching your feeds…”; during startup hydration before a feed fetch begins, it SHALL display “Loading…”. The loading message SHALL only become visible once the loading has lasted at least ~500ms, fading in gradually. The app SHALL NOT hide navigation or chrome in any empty or loading state.

#### Scenario: Feed being fetched — loading message shown

- **GIVEN** a visible feed has no items in IndexedDB
- **WHEN** that feed is being fetched
- **THEN** the river SHALL display “Fetching your feeds…” instead of an empty state
- **AND** the message SHALL only become visible once the loading has lasted at least ~500ms, fading in gradually

#### Scenario: App is hydrating on startup

- **GIVEN** the app has no visible items in its reactive state yet
- **WHEN** it is still hydrating feeds/items from IndexedDB and no visible feed fetch has begun
- **THEN** the river SHALL display “Loading…” instead of an empty state

#### Scenario: Fetch completes — items replace loading message

- **GIVEN** the loading message is displayed
- **WHEN** the feed fetch completes and items are stored
- **THEN** the message SHALL be replaced by the fetched items within the same rendering frame that items are loaded into the reactive state

#### Scenario: No unread items in Unread mode (no fetch in progress)

- **WHEN** the user is in "Unread" mode and IndexedDB contains no unread items
- **AND** no feed fetch is in progress
- **THEN** the river body shows "You're all caught up." and a "Check for new items" link below it (unchanged)

#### Scenario: Zero items in All mode (fresh install, no fetch in progress)

- **WHEN** the user is in "All" mode and IndexedDB contains no items
- **AND** no feed fetch is in progress
- **THEN** the river body shows an empty state describing that no feeds are subscribed (unchanged)
