## ADDED Requirements

### Requirement: High contrast is an orthogonal toggle

The system SHALL provide a high contrast mode as a boolean toggle independent of the theme (light/dark/system) selection.

#### Scenario: HC + system theme
- **WHEN** user enables high contrast with theme set to "system"
- **THEN** the page SHALL use the high-contrast light palette when `prefers-color-scheme` is light AND the high-contrast dark palette when `prefers-color-scheme` is dark

#### Scenario: HC + light theme
- **WHEN** user enables high contrast with theme set to "light"
- **THEN** the page SHALL use the high-contrast light palette regardless of system preference

#### Scenario: HC + dark theme
- **WHEN** user enables high contrast with theme set to "dark"
- **THEN** the page SHALL use the high-contrast dark palette regardless of system preference

#### Scenario: HC disabled
- **WHEN** user disables high contrast
- **THEN** the page SHALL revert to the standard Catppuccin palette for the selected theme

#### Scenario: HC persists across reloads
- **WHEN** user enables high contrast and reloads the page
- **THEN** the high-contrast setting SHALL be restored from persisted settings

### Requirement: High contrast provides sufficient color contrast

When high contrast mode is active, all text-background color pairs SHALL meet WCAG AA (4.5:1) minimum contrast ratio, and primary text-background pairs SHOULD meet WCAG AAA (7:1).

#### Scenario: Primary text contrast
- **WHEN** high contrast mode is active
- **THEN** the contrast ratio between `--text` and `--base` SHALL be at least 7:1 in both light and dark modes

#### Scenario: Secondary text contrast
- **WHEN** high contrast mode is active
- **THEN** the contrast ratio between `--subtext` and `--base` SHALL be at least 4.5:1 in both light and dark modes

#### Scenario: Muted text contrast
- **WHEN** high contrast mode is active
- **THEN** the contrast ratio between `--overlay` and `--base` SHALL be at least 4.5:1 in both light and dark modes

#### Scenario: Accent contrast
- **WHEN** high contrast mode is active
- **THEN** the contrast ratio between `--accent` and `--base` SHALL be at least 4.5:1 in both light and dark modes

### Requirement: Read items are fully opaque in high contrast mode

When high contrast mode is active, read items SHALL retain full opacity to maximize readability.

#### Scenario: Read items not dimmed
- **WHEN** high contrast mode is active
- **THEN** `.river-item.read` SHALL have `opacity: 1`

### Requirement: High contrast uses pushed-Catppuccin color palette

The high-contrast color values SHALL be derived by pushing Catppuccin hues toward higher contrast extremes while preserving the same accent color.

#### Scenario: Light palette values
- **WHEN** high contrast light mode is active
- **THEN** color variables SHALL match the values defined in the design document for light HC

#### Scenario: Dark palette values
- **WHEN** high contrast dark mode is active
- **THEN** color variables SHALL match the values defined in the design document for dark HC

### Requirement: Settings UI reflects orthogonal model

The settings drawer SHALL present theme selection (system/light/dark) and high contrast toggle as separate controls.

#### Scenario: Theme selector excludes accessible
- **WHEN** user opens settings
- **THEN** the theme selector SHALL show three options: "Follow system", "Light", "Dark"

#### Scenario: High contrast toggle present
- **WHEN** user opens settings
- **THEN** the high contrast toggle SHALL be visible and independent of the theme selector
