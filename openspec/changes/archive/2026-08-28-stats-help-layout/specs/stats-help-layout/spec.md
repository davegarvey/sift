## Purpose

Keep the stats help action aligned with the page context while reducing unnecessary vertical space on narrow screens.

## ADDED Requirements

### Requirement: Stats help shares the kicker row

The stats view SHALL place the help CTA on the same heading row as the Stats kicker on desktop and narrow layouts. The layout SHALL not reserve an additional mobile-only block of vertical space solely for the help CTA.

#### Scenario: Desktop heading alignment

- **WHEN** the stats view is rendered on a desktop layout
- **THEN** the help CTA SHALL share a row with the Stats kicker
- **AND** the page title and description SHALL remain below that row

#### Scenario: Narrow heading alignment

- **WHEN** the stats view is rendered on a narrow layout
- **THEN** the help CTA SHALL remain on the Stats kicker row
- **AND** the heading SHALL not include a separate top spacer for the CTA

### Requirement: Help explanation behavior is preserved

Moving the help CTA SHALL preserve its accessible name, expanded state, keyboard focus behavior, outside-click dismissal, Escape dismissal, and responsive explanation panel.

#### Scenario: Open and close the explanation

- **WHEN** the user activates the help CTA
- **THEN** the explanation panel SHALL open adjacent to the CTA
- **AND** the CTA SHALL expose its expanded state
- **AND** the user SHALL be able to close it with the close control, Escape, or an outside click
