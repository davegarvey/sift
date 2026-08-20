## ADDED Requirements

### Requirement: River respects fixed TopBar on mobile
On mobile viewports the river SHALL offset its content below the fixed TopBar so that feed items are not obscured by the navigation bar.

#### Scenario: River content is below the TopBar on mobile
- **WHEN** the viewport is 768px or narrower
- **THEN** the river has padding at the top equal to the TopBar height (40px on non-touch devices, 44px on touch devices)
- **AND** the first feed item is fully visible below the TopBar without scrolling

#### Scenario: Desktop layout is unaffected
- **WHEN** the viewport is wider than 768px
- **THEN** the river has no padding-top for the TopBar
