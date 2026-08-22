## ADDED Requirements

### Requirement: Filter and scope are independent controls in the sidebar

The sidebar SHALL provide two independent navigation axes: a filter toggle that controls whether the river shows only unread items or all items, and scope rows that control which feed (or all feeds) the river displays. Changing the filter SHALL NOT change the scope. Changing the scope SHALL NOT change the filter. The active state of each control SHALL be visible regardless of the other's state.

#### Scenario: User toggles the filter while viewing all feeds
- **WHEN** the user clicks the filter toggle while the scope is set to all feeds
- **THEN** the river immediately re-fetches and shows items matching the new filter
- **AND** the scope remains at all feeds

#### Scenario: User toggles the filter while viewing a single feed
- **WHEN** the user clicks the filter toggle while the scope is set to a specific feed
- **THEN** the river immediately re-fetches and shows items from that feed matching the new filter
- **AND** the scope remains on that feed
- **AND** the filter toggle still shows its active state

#### Scenario: User selects a feed while filter is on unread
- **WHEN** the user clicks a feed in the sidebar while the filter is set to unread
- **THEN** the river shows only unread items from that feed
- **AND** the filter toggle still shows unread as active

#### Scenario: User returns to all-feeds scope
- **WHEN** the user clicks "All Feeds" in the sidebar
- **THEN** the river shows items from all subscribed feeds filtered by the current readFilter

#### Scenario: Filter and scope persist across reload
- **WHEN** the user reloads the app
- **THEN** the last-selected scope and filter are restored from settings

### Requirement: Filter toggle uses icons

The filter toggle SHALL be a two-button segmented control using Lucide `CircleDot` (unread) and `Inbox` (all items) icons. On desktop viewports the icons SHALL be accompanied by text labels. On mobile viewports the labels SHALL be hidden. The active segment SHALL use the accent color.

#### Scenario: Desktop user sees the toggle
- **WHEN** the sidebar is rendered on a desktop-width viewport
- **THEN** the toggle shows both icons and their text labels (Unread / All)
- **AND** the active segment has the accent background

#### Scenario: Mobile user sees the toggle
- **WHEN** the sidebar is rendered on a mobile-width viewport
- **THEN** the toggle shows only the icons without text labels
