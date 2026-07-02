## ADDED Requirements

### Requirement: User can choose reading font

The system SHALL allow users to choose between serif and sans-serif font for the article reading view body, headings, and title. The preference SHALL persist across sessions. The default SHALL be serif.

#### Scenario: Default reading font is serif

- **WHEN** a user opens an article for the first time without having changed any font setting
- **THEN** the article body, headings, and title SHALL be rendered in the serif font stack

#### Scenario: User switches to sans-serif in Settings

- **WHEN** the user selects "Sans-serif" from the Reading Font dropdown in Settings
- **THEN** the reading view body, headings, and title SHALL immediately switch to the sans-serif font stack
- **AND** the preference SHALL be persisted to IndexedDB

#### Scenario: Preference persists after page reload

- **WHEN** the user selects "Sans-serif", closes Settings, and reloads the page
- **THEN** the reading view SHALL render in the sans-serif font stack

#### Scenario: User switches back to serif

- **WHEN** the user selects "Serif" from the Reading Font dropdown
- **THEN** the reading view SHALL immediately render in the serif font stack
- **AND** the preference SHALL be persisted

### Requirement: Brand elements are unaffected

The sidebar wordmark, collapsed brand mark, and mobile topbar wordmark SHALL always render in the serif font stack regardless of the reading font preference.

#### Scenario: Brand mark stays serif when reading font is sans-serif

- **WHEN** the user selects "Sans-serif" for the reading font
- **THEN** the "sift" wordmark in the sidebar SHALL remain in the serif font stack

### Requirement: Font preference has no side effects

Changing the reading font preference SHALL NOT affect any other settings, theme, or UI behavior outside the reading view.

#### Scenario: Theme is unchanged by font change

- **WHEN** the user changes the reading font preference
- **THEN** the theme (light/dark/high contrast) SHALL remain unchanged
