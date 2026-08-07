## Purpose

Defines how the sidebar presents itself when the user has no feeds subscribed.

## ADDED Requirements

### Requirement: Filter chips hidden without feeds
The sidebar SHALL not render the tag filter chips (`all`, starred) when there are no subscribed feeds.

#### Scenario: No feeds on boot
- **WHEN** the user has zero subscribed feeds and the sidebar is expanded
- **THEN** the `all` and starred filter chips are not displayed

#### Scenario: Feeds added later
- **WHEN** the user adds their first feed
- **THEN** the filter chips appear again

### Requirement: Feed list empty placeholder
When there are no subscribed feeds, the sidebar SHALL display a muted "No feeds, yet." placeholder where the feed list would render.

#### Scenario: Empty list placeholder shown
- **WHEN** the user has zero subscribed feeds and the sidebar is expanded
- **THEN** the sidebar shows the "No feeds, yet." placeholder in place of the feed list

#### Scenario: Placeholder replaced by feeds
- **WHEN** the user adds their first feed
- **THEN** the placeholder is replaced by the list of feeds
