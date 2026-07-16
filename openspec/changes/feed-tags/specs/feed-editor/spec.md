## ADDED Requirements

### Requirement: Feed editor modal
A modal SHALL provide tag management and unsubscribe for a single feed. It SHALL be accessible from a `…` button on the feed row (replacing the current `✕` button).

#### Scenario: Open feed editor from sidebar
- **WHEN** user clicks the `…` button on a feed row
- **THEN** a modal SHALL open titled "Edit <feed title>"
- **THEN** the modal SHALL show the feed's current tags as removable chips with `✕`
- **THEN** the modal SHALL show a tag input with autocomplete
- **THEN** the modal SHALL show an `[Unsubscribe]` button (red, destructive styling) separated by a divider
- **THEN** the modal SHALL show a `[Cancel]` button

#### Scenario: `…` button visibility
- **WHEN** user hovers over a feed row on desktop
- **THEN** the `…` button SHALL be visible (same hover-reveal pattern as current `✕`)
- **WHEN** user is on a touch device
- **THEN** the `…` button SHALL always be visible

#### Scenario: Remove tag auto-saves immediately
- **WHEN** user clicks `✕` on a tag chip in the feed editor modal
- **THEN** the tag SHALL be removed from this feed and persisted to IndexedDB immediately
- **THEN** the chip SHALL disappear from the modal
- **THEN** the sidebar tag chips SHALL update immediately

#### Scenario: Add tag auto-saves immediately
- **WHEN** user types in the tag input and presses Enter or clicks a suggestion
- **THEN** the tag SHALL be added to this feed and persisted to IndexedDB immediately
- **THEN** it SHALL appear as a chip in the modal
- **THEN** the sidebar tag chips SHALL update immediately

#### Scenario: Unsubscribe from feed editor
- **WHEN** user clicks `[Unsubscribe]`
- **THEN** a confirmation prompt SHALL appear (same pattern as current confirm-unsubscribe)
- **THEN** if confirmed, the feed and its items SHALL be deleted
- **THEN** the modal SHALL close

#### Scenario: Done closes the modal
- **WHEN** user clicks `[Done]`
- **THEN** the modal SHALL close
- **THEN** no additional save or discard action SHALL be taken (changes already persisted)
