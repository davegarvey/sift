# starred-filter Specification

## Purpose

TBD - created by archiving change starred-filter. Update Purpose after archive.

## Requirements

### Requirement: Sidebar star toggle
The sidebar SHALL display a ★ button that toggles the starred-only filter on and off. The button SHALL use the Mauve accent color when active (consistent with active tag chips) and SHALL have a filled star icon when active. The button SHALL NOT clear `riverScope` or `activeTags` when toggled.

#### Scenario: Toggle star filter on
- **WHEN** the user clicks the ★ button in the sidebar
- **THEN** the star filter becomes active
- **AND** the ★ button displays with filled icon and active accent color
- **AND** the current item list narrows to show only starred items
- **AND** `riverScope` and `activeTags` are unchanged

#### Scenario: Toggle star filter off
- **WHEN** the user clicks the ★ button while the star filter is active
- **THEN** the star filter becomes inactive
- **AND** the ★ button displays with outline/unfilled icon
- **AND** the item list returns to showing all items for the current scope
- **AND** `riverScope` and `activeTags` are unchanged

#### Scenario: Star filter persists across view switches
- **WHEN** the user has the star filter active while viewing "all"
- **AND** the user clicks a tag or feed
- **THEN** the star filter SHALL remain active
- **AND** the items displayed SHALL be starred items within the new view

### Requirement: River filter
The river item list SHALL filter to starred-only items when `starredOnly` is true. The filter SHALL compose with existing filters (feed scope, tag selection) as an AND condition.

#### Scenario: Starred filter with no feed/tag scope
- **WHEN** `starredOnly` is true
- **AND** `riverScope` is null
- **AND** `activeTags` is empty
- **THEN** items SHALL be loaded via `listStarred()` for efficient IndexedDB access

#### Scenario: Starred filter with feed scope
- **WHEN** `starredOnly` is true
- **AND** `riverScope` is set to a feed ID
- **THEN** only starred items from that feed SHALL be displayed

#### Scenario: Starred filter with tag scope
- **WHEN** `starredOnly` is true
- **AND** `activeTags` has one or more tags
- **THEN** only starred items from feeds matching those tags SHALL be displayed

### Requirement: Collapsed sidebar rail
The ★ button SHALL also appear in the collapsed desktop sidebar rail (where Add Feed, Refresh, Search, Settings, Shortcuts appear). This ensures the filter is accessible without expanding the sidebar.

#### Scenario: Collapsed rail shows star toggle
- **WHEN** the sidebar is collapsed on desktop
- **THEN** a ★ button SHALL be visible in the action rail
- **AND** clicking it SHALL toggle the star filter identically to the expanded sidebar button

### Requirement: Empty state awareness
When the star filter is active and no items match, the empty state SHALL display a contextually appropriate message and provide a way to disable the filter.

#### Scenario: No starred items in current scope
- **WHEN** `starredOnly` is true
- **AND** no items in the current scope are starred
- **THEN** the empty state SHALL show "No starred items" instead of the default message
- **AND** the empty state SHALL include a button or link to disable the star filter

#### Scenario: User unstars the last visible item
- **WHEN** the user is in reading view on a starred item under the active star filter
- **AND** the user unstars that item
- **AND** returns to the river
- **THEN** the river SHALL show the contextual empty state (as above) rather than a generic "No items yet" message

### Requirement: State management
The `AppState` SHALL include a `starredOnly: boolean` field (default `false`). The `toggleStarFilter` action SHALL toggle this value and reset `focusedIndex` to 0. The `setRiverScope` and `toggleTag` actions SHALL NOT modify `starredOnly`.

#### Scenario: Orthogonal to feed/tag scope
- **WHEN** `toggleStarredOnly` is called
- **THEN** `riverScope` and `activeTags` SHALL remain unchanged
- **AND** only `starredOnly` is toggled

#### Scenario: View switches preserve starred filter
- **WHEN** `setRiverScope` or `toggleTag` is called
- **THEN** `starredOnly` SHALL remain unchanged