## ADDED Requirements

### Requirement: River restores focus to previously viewed item
When the user returns to the river after reading an article, the focused item SHALL be the item they most recently opened in the reading view.

#### Scenario: User opens article via click and returns
- **WHEN** the user clicks an item in the river to open it in the reading view
- **AND** the user returns to the river (via Escape, back button, or clicking Back)
- **THEN** the river SHALL set `focusedIndex` to the position of that same item in the current items list
- **AND** the existing `onFocusChange` mechanism SHALL scroll that item into view

#### Scenario: User opens article via keyboard and returns
- **WHEN** the user uses `j`/`k` to focus an item and presses Enter to open it
- **AND** the user returns to the river
- **THEN** the river SHALL set `focusedIndex` to the position of that same item

#### Scenario: Item no longer exists on return
- **WHEN** the item the user was reading is no longer present in the items list (e.g., evicted, feed removed)
- **THEN** `focusedIndex` SHALL remain at its previous value

#### Scenario: Item appears at different index on return
- **WHEN** the items list has changed between opening and returning (e.g., new items added, read status changed) and the viewed item is found at a different index
- **THEN** `focusedIndex` SHALL be set to the item's new index in the refreshed list
