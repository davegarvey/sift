## ADDED Requirements

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
- **THEN** all feeds are refreshed

#### Scenario: Refresh in progress
- **WHEN** a refresh is in progress
- **THEN** the refresh button is disabled and shows the spinning indicator

#### Scenario: Buttons are accessible
- **WHEN** the heading action buttons are rendered
- **THEN** each button exposes an accessible name describing its action

### Requirement: Fixed navigation zones
The sidebar SHALL keep the Feeds heading row and the tag chips fixed while the feed list scrolls independently. The heading row and tag chips SHALL remain visible at all scroll positions of the feed list.

#### Scenario: Scrolling a long feed list
- **WHEN** the feed list is scrolled to any position
- **THEN** the Feeds heading row and tag chips remain visible without scrolling

#### Scenario: Scrolling beyond the last feed
- **WHEN** the user scrolls the feed list to its end
- **THEN** only the feed list scrolls, and the header, tag chips, and bottom action group stay in place

### Requirement: Empty-state add feed
When no feeds are subscribed, the sidebar SHALL hide the heading action icons and SHALL render a prominent add-feed button in the feed list area as the only add-feed affordance. This state SHALL apply only when there are zero subscribed feeds, not when a tag filter matches no feeds.

#### Scenario: Fresh install
- **WHEN** the user has no subscribed feeds and opens the sidebar
- **THEN** the Feeds heading row shows no action icons, and a prominent "Add your first feed" button appears in the feed list area

#### Scenario: Adding the first feed
- **WHEN** the user activates the "Add your first feed" button
- **THEN** the add-feed modal opens

#### Scenario: Empty result from tag filter
- **WHEN** feeds are subscribed but the active tag filter matches none of them
- **THEN** the heading action icons remain visible and the "Add your first feed" empty-state button is not shown
