## ADDED Requirements

### Requirement: Chrome title visibility
When the article title has scrolled past the sticky chrome, the chrome SHALL display the article title in its spacer area so the user retains reading context.

#### Scenario: Title appears on scroll
- **WHEN** the user scrolls the article body so that the `<h1>` top edge is above the bottom of the sticky chrome
- **THEN** the chrome SHALL show the article title in the spacer area

#### Scenario: Title hides when at top
- **WHEN** the user scrolls the article body so that the `<h1>` top edge is at or below the bottom of the sticky chrome
- **THEN** the chrome SHALL NOT show the article title in the spacer area

#### Scenario: Fade transition
- **WHEN** the chrome title visibility changes
- **THEN** the transition SHALL use a 150ms opacity fade

### Requirement: Title truncation
The chrome title SHALL truncate with ellipsis when the available width is insufficient to display the full title.

#### Scenario: Truncation on narrow viewport
- **WHEN** the chrome title text exceeds the available width in the spacer
- **THEN** the title SHALL be truncated with an ellipsis character

#### Scenario: Full title on wide viewport
- **WHEN** the chrome title text fits within the available width in the spacer
- **THEN** the title SHALL be displayed in full

### Requirement: Chrome column alignment
On desktop, the chrome's content area SHALL align to the same column width and left edge as the article body (`--measure: 65ch`), ensuring the title in the chrome shares the same x-position as the `<h1>` in the body.

#### Scenario: Desktop alignment
- **WHEN** the viewport width is greater than `65ch + 48px` (column + padding)
- **THEN** the chrome's inner content SHALL be constrained to `max-width: var(--measure)` and centered, matching the article body

#### Scenario: Mobile fill
- **WHEN** the viewport width is less than or equal to `65ch + 48px`
- **THEN** the chrome's inner content SHALL fill the full chrome width

### Requirement: Document title sync
The browser tab/window title SHALL reflect the article being read and reset when leaving reading view.

#### Scenario: Title set on open
- **WHEN** the reading view opens with an article
- **THEN** `document.title` SHALL be set to `"<article title> — Sift"`

#### Scenario: Title updated on navigation
- **WHEN** the user navigates to a different article (prev/next) within the reading view
- **THEN** `document.title` SHALL update to `"<new article title> — Sift"`

#### Scenario: Title reset on close
- **WHEN** the user returns to the river view
- **THEN** `document.title` SHALL be set to `"Sift"`
