## ADDED Requirements

### Requirement: Command palette search is debounced
The command palette SHALL debounce search queries so that a full IndexedDB scan does not fire on every keystroke. In-flight searches SHALL be cancellable via AbortController when a new query arrives before the previous one completes.

#### Scenario: Rapid keystrokes produce one search
- **WHEN** the user types three characters within 200ms
- **THEN** only one search query is dispatched (after the debounce window expires)

#### Scenario: Subsequent keystroke cancels in-flight search
- **WHEN** a search is in-flight (scanning items) and the user types an additional character
- **THEN** the in-flight search SHALL be aborted via AbortController

### Requirement: Aborted searches must not overwrite newer results
The aborted search's promise MUST NOT call `setResults()` after a newer search has already written results. A generation counter SHALL be incremented on each new search dispatch; the old search's completion handler SHALL check its generation against the current value before calling `setResults()`.

#### Scenario: Aborted search discards its results
- **WHEN** search A is in-flight, search B starts (incrementing the counter), then search A's cursor completes
- **THEN** search A SHALL detect that its generation is stale and SHALL NOT call `setResults()`

#### Scenario: Empty or whitespace query aborts in-flight search
- **WHEN** a search is in-flight and the user backspaces to an empty query
- **THEN** the in-flight search SHALL be aborted and results SHALL be cleared

### Requirement: Query shorter than 2 characters is ignored
- **WHEN** the query is a single character
- **THEN** no search SHALL be dispatched

### Requirement: Feed title lookup uses a hash map
The river SHALL resolve feed titles via a `Map<string, Feed>` rather than calling `Array.find()` on every rendered item. The map SHALL be derived from the feeds signal via a memoized computation.

#### Scenario: River renders feed title from map
- **WHEN** the river renders an item
- **THEN** the feed title SHALL be resolved via `feedMap.get(item.feedUrl)?.title`

#### Scenario: Map updates when feeds change
- **WHEN** the feeds array changes (e.g., after adding a feed)
- **THEN** the feed map SHALL update reactively on the next render

### Requirement: Polling pauses when tab is hidden
The 30-second polling interval SHALL skip `reloadFeeds()` and `reloadItems()` when the document is not visible (`document.visibilityState === 'hidden'`). The interval timer SHALL remain active and resume normal execution when the tab becomes visible.

#### Scenario: Polling skipped on hidden tab
- **WHEN** the document visibility is 'hidden' at the moment a poll tick fires
- **THEN** `reloadFeeds()` and `reloadItems()` SHALL NOT be called

#### Scenario: Polling resumes when tab is visible again
- **WHEN** the document visibility changes from 'hidden' to 'visible'
- **THEN** the next poll tick SHALL run normally, including a fresh `reloadFeeds()` + `reloadItems()`

### Requirement: Immediate refresh on tab return
In addition to skipping work while hidden, the app SHALL listen for `visibilitychange` events. When the document transitions from 'hidden' to 'visible', a feed refresh SHALL be triggered immediately (not waiting for the next 30-second tick).

#### Scenario: Refresh fires on tab return
- **WHEN** the document visibility changes from 'hidden' to 'visible'
- **THEN** `reloadFeeds()` and `reloadItems()` SHALL be called within 1 second

#### Scenario: Visibility refresh does not fire on initial page load
- **WHEN** the page loads for the first time (visibility was never explicitly 'hidden')
- **THEN** the `visibilitychange` handler SHALL NOT trigger a duplicate initial refresh
