## ADDED Requirements

### Requirement: About page navigation

The expanded sidebar footer and collapsed desktop rail SHALL provide an accessible About link using the Lucide `Info` icon.

#### Scenario: Expanded sidebar

- **WHEN** the sidebar is expanded
- **THEN** its footer SHALL include an About link to `/about` beside Settings

#### Scenario: Collapsed desktop rail

- **WHEN** the sidebar is collapsed on desktop
- **THEN** the rail SHALL include an accessible About link to `/about`
