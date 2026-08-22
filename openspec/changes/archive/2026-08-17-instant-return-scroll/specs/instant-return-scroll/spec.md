## ADDED Requirements

### Requirement: Instant scroll on return from reading view
When the user closes the reading view and returns to the river, the scroll to the previously focused item SHALL happen without visible animation. The user SHALL see the river immediately with the correct scroll position.

#### Scenario: Returning from reading view snaps to item
- **WHEN** the user clicks the back button in reading view
- **THEN** the river appears immediately (no blank screen or stale reading view during DB operations)
- **AND** the previously focused item is scrolled into view without any smooth-scroll animation
- **AND** the item receives the `focused` CSS class

#### Scenario: Background reload does not re-scroll
- **WHEN** the river is visible and scrolled to the return item
- **AND** `reloadItems` completes with updated item data
- **THEN** the scroll position SHALL remain at the return item (no re-scroll triggered)

### Requirement: View switch precedes data reload
The river view SHALL be rendered before awaiting the items reload, to eliminate perceptual delay.

#### Scenario: Immediate view switch
- **WHEN** `closeReading` is called
- **THEN** `setState({ view: 'river', currentItem: null })` SHALL execute before `reloadItems` is awaited
- **AND** the river SHALL mount immediately with the existing items list

### Requirement: Single-effect-pass scroll
The return-to-item scroll SHALL happen in the same SolidJS effect pass that resolves `returnToItemId`, avoiding a two-pass render cycle.

#### Scenario: Single pass scroll
- **WHEN** the river's `createEffect` detects a non-null `returnToItemId`
- **THEN** it SHALL find the matching DOM element and call `scrollIntoView` with `behavior: 'instant'`
- **AND** set `returnToItemId` to null and `focusedIndex` to the found index
- **ALL in the same effect run**
