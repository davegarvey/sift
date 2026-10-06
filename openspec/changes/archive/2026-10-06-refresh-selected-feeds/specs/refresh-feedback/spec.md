## MODIFIED Requirements

### Requirement: Optimistic visual feedback on refresh-all click

When the user triggers a manual refresh of the current feed selection, the UI SHALL provide immediate visual confirmation that the click was received, before any async work begins. Background feed fetches SHALL not activate this manual-refresh feedback.

#### Scenario: Refresh button shows spinning icon on click
- **WHEN** the user clicks the Refresh button, presses `r`, triggers refresh through the command palette, or activates the empty-state refresh link
- **THEN** the refresh icon SHALL start spinning immediately and the button SHALL become disabled synchronously, before any network or IndexedDB operation has completed
- **AND** the accessible name SHALL describe whether the action refreshes all feeds, one feed, or the selected tag feeds

#### Scenario: Visual feedback persists through fetch cycle
- **WHEN** manually refreshing a selected feed scope
- **THEN** the button SHALL remain disabled and the icon SHALL remain spinning continuously from the moment of the action until the targeted feed fetch cycle completes, with no gap where the button reverts to its idle state

#### Scenario: Error during refresh does not leave button stuck
- **WHEN** a manual refresh action encounters an error, including a sync server failure, feed fetch failure, or IndexedDB error
- **THEN** the counter tracking the in-flight state SHALL be decremented in a `finally` block so the button and icon return to their idle state regardless of error
