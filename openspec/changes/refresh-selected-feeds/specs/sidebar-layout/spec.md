## MODIFIED Requirements

### Requirement: Heading row compact actions

The sidebar SHALL render the Add feed and Refresh actions as compact icon buttons inside the Feeds heading row when at least one feed is subscribed. The buttons SHALL have accessible labels and SHALL behave identically to the current full-width actions.

#### Scenario: Feeds heading shows compact actions
- **WHEN** the sidebar is expanded and at least one feed is subscribed
- **THEN** the Feeds heading row shows an add-feed icon button and a refresh icon button next to the heading text

#### Scenario: Adding a feed from the heading
- **WHEN** the user activates the add-feed icon button in the Feeds heading
- **THEN** the add-feed modal opens

#### Scenario: Refreshing all feeds from the heading
- **WHEN** the user activates the refresh icon button in the Feeds heading
- **THEN** all feeds are refreshed when All is selected
- **AND** only the selected feed is refreshed when a feed is selected
- **AND** only feeds matching the selected tags are refreshed when one or more tags are selected

#### Scenario: Refresh in progress
- **WHEN** a manual refresh is in progress
- **THEN** the refresh button is disabled and shows the spinning indicator

#### Scenario: Buttons are accessible
- **WHEN** the heading action buttons are rendered
- **THEN** each button exposes an accessible name describing its action and current refresh scope
