## ADDED Requirements

### Requirement: Optimistic visual feedback on refresh-all click
When the user triggers a refresh-all action, the UI SHALL provide immediate visual confirmation that the click was received, before any async work begins.

#### Scenario: Refresh button shows spinning icon on click
- **WHEN** the user clicks the Refresh all button (or presses `r`, or triggers refresh-all via command palette / empty-state link)
- **THEN** the refresh icon SHALL start spinning immediately and the button SHALL become disabled synchronously, before any network or IndexedDB operation has completed

#### Scenario: Visual feedback persists through fetch cycle
- **WHEN** refreshing all feeds
- **THEN** the button SHALL remain disabled and the icon SHALL remain spinning continuously from the moment of the click until per-feed spinners appear in the sidebar feed list, with no gap where the button reverts to its idle state

#### Scenario: Error during refresh does not leave button stuck
- **WHEN** a refresh-all action encounters an error (sync server unreachable, feed fetch failure, IndexedDB error)
- **THEN** the counter tracking the in-flight state SHALL be decremented in a `finally` block so the button and icon return to their idle state regardless of error

### Requirement: Background auto-refresh does not show optimistic feedback
The background tick SHALL NOT trigger optimistic visual feedback, since there is no user action to acknowledge.

#### Scenario: Background tick does not disable button
- **WHEN** the periodic auto-refresh tick runs
- **THEN** the refresh button SHALL remain enabled and the icon SHALL NOT spin unless the user manually initiated a refresh
