## ADDED Requirements

### Requirement: Tag chips in sidebar feed list
The sidebar SHALL render tag chips between the "Feeds" heading and the "All Feeds" entry.

#### Scenario: Tag chips render in correct position
- **WHEN** at least one feed has tags
- **THEN** tag chips SHALL appear between the "FEEDS" heading and the "All Feeds" entry
- **THEN** chips SHALL use the existing sidebar design language (font-size 12px, surface background, accent for active)

### Requirement: Feed row action button changes from ✕ to …
The hover-reveal action on feed rows SHALL change from `✕` (delete) to `…` (more actions). The `…` button SHALL open the feed editor modal. The old pattern (direct delete confirmation) SHALL be removed.

#### Scenario: … button visibility matches existing pattern
- **WHEN** user hovers over a feed row on desktop
- **THEN** the `…` button SHALL be visible (same position and hover-reveal as current `✕`)
- **WHEN** user is on a touch device
- **THEN** the `…` button SHALL always be visible

#### Scenario: Clicking … opens feed editor
- **WHEN** user clicks the `…` button
- **THEN** the feed editor modal SHALL open
- **THEN** the modal SHALL show the feed title, current tags, tag input, unsubscribe button, and Done button
