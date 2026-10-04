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

- **WHEN** the user is in "Unread" mode and the current feed/tag scope contains no unread items and Starred is inactive
- **AND** no feed fetch is in progress
- **THEN** the river SHALL show “You’re caught up” and a “Show all articles” button that switches to All within the current scope
- **AND** this state SHALL appear only when the scope contains stored articles and has no relevant refresh failure; a scope without stored articles SHALL retain its existing empty or failure feedback

#### Scenario: Zero items in All mode (fresh install, no fetch in progress)

- **WHEN** the user is in "All" mode and IndexedDB contains no items
- **AND** no feed fetch is in progress
- **THEN** the river SHALL retain the existing subscription, empty-scope or failure feedback appropriate to the current selection

