## MODIFIED Requirements

### Requirement: Stats help shares the kicker row

The stats view SHALL place the help CTA on the same heading row as the Stats kicker on desktop and narrow layouts. The heading row SHALL use the full content boundary shared by the stats summary and feed table, with the help CTA aligned to that boundary. The layout SHALL not reserve an additional mobile-only block of vertical space solely for the help CTA.

#### Scenario: Desktop heading alignment

- **WHEN** the stats view is rendered on a desktop layout
- **THEN** the help CTA SHALL share a row with the Stats kicker
- **AND** the page title and description SHALL remain below that row

#### Scenario: Narrow heading alignment

- **WHEN** the stats view is rendered on a narrow layout
- **THEN** the help CTA SHALL remain on the Stats kicker row
- **AND** the heading SHALL not include a separate top spacer for the CTA

#### Scenario: Shared content boundary

- **WHEN** the stats view is rendered at a width where the content container is wider than the heading copy
- **THEN** the help CTA's right edge SHALL align with the right edge of the stats summary and feed table
- **AND** the title and description SHALL retain their readable maximum widths
