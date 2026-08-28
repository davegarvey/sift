## Purpose

Make feed statistics ordering discoverable through the table itself while preserving each user's preferred local view between visits.

## ADDED Requirements

### Requirement: Sortable stats columns

The stats view SHALL expose the feed title and each displayed numeric metric as sortable column headings: Articles, Read, Rate, Expected, and Preference. Selecting an inactive heading SHALL sort by that column in its default direction. Selecting the active heading again SHALL toggle between ascending and descending order. The view SHALL not expose a separate sort option for a metric that is not represented by a visible column.

#### Scenario: Initial stats order

- **WHEN** no stats sort preference has been saved
- **THEN** the stats view SHALL order feeds by Read descending
- **AND** the Read heading SHALL indicate that it is the active descending sort

#### Scenario: Select a different numeric column

- **WHEN** the user selects the Rate heading while another column is active
- **THEN** the feeds SHALL be ordered by Rate descending
- **AND** the Rate heading SHALL indicate that it is the active descending sort

#### Scenario: Toggle the active column

- **WHEN** the user selects the active Read heading
- **THEN** the feeds SHALL be ordered by Read ascending
- **AND** the Read heading SHALL indicate that it is the active ascending sort

#### Scenario: Sort feed titles

- **WHEN** the user selects the Feed heading
- **THEN** the feeds SHALL be ordered alphabetically by feed title ascending
- **AND** selecting the Feed heading again SHALL order titles descending

### Requirement: Clear sort state and stable values

The active stats heading SHALL show a small directional indicator, and inactive headings SHALL remain visibly available as sort controls. The active heading SHALL expose its current direction to assistive technology. Unavailable derived values SHALL sort after numeric values in either direction. Equal values SHALL use feed title ascending as the secondary order.

#### Scenario: Unavailable values remain last

- **WHEN** the user sorts by Rate, Expected, or Preference in either direction
- **AND** one or more feeds have an unavailable value
- **THEN** those feeds SHALL appear after feeds with numeric values

#### Scenario: Equal values have deterministic ordering

- **WHEN** two feeds have equal values for the active numeric column
- **THEN** the feed with the alphabetically earlier title SHALL appear first

#### Scenario: Keyboard sorting

- **WHEN** a keyboard user focuses a sortable heading and activates it
- **THEN** the same sort selection and direction change SHALL occur as for pointer activation

### Requirement: Local sort preference

The stats view SHALL remember the selected column and direction in local application settings. The saved preference SHALL be restored when the user returns to the stats view or reloads the application. The preference SHALL not be sent to or read from the sync service.

#### Scenario: Restore the saved order

- **WHEN** the user selects Preference ascending and later opens the stats view again
- **THEN** the feeds SHALL initially be ordered by Preference ascending
- **AND** the Preference heading SHALL indicate the active ascending sort

#### Scenario: Sort preference is local-only

- **WHEN** the user changes the stats sort order while sync is enabled
- **THEN** the change SHALL be persisted locally
- **AND** it SHALL not modify synchronized group data or require a sync request

### Requirement: Responsive sorting access

The stats view SHALL provide an accessible sorting control on narrow layouts where the desktop table headings are not displayed. The mobile control SHALL expose the same columns and directions as the desktop headings and SHALL reflect the persisted active selection.

#### Scenario: Sort on a narrow layout

- **WHEN** the user views stats on a narrow layout
- **THEN** the user SHALL be able to select a visible stats column and ascending or descending direction
- **AND** the feed order SHALL update without requiring horizontal scrolling of the table
