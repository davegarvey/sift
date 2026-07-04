## ADDED Requirements

### Requirement: Desktop chevron navigation
Reading view SHALL display ◀ and ▶ chevrons in the left and right margin gutters respectively when there are prev/next articles available. Chevrons SHALL be vertically centered in the viewport. The entire margin strip from viewport edge to content edge SHALL act as the click/tap hit zone. Chevrons SHALL be non-interactive (ghosted) at the first/last boundary and SHALL NOT appear when there is only one item in results.

#### Scenario: Chevrons appear in margins when prev/next articles exist
- **WHEN** user opens an article in reading view and there are items on both sides in the filtered results
- **THEN** ◀ and ▶ chevrons SHALL be visible at low opacity (~15%) in the left and right margin gutters, vertically centered

#### Scenario: Chevrons become fully opaque on hover
- **WHEN** user moves cursor into the margin hit zone
- **THEN** the corresponding chevron SHALL transition to full opacity with a smooth CSS animation

#### Scenario: Left chevron is ghosted at first item
- **WHEN** user is reading the first item in the filtered results
- **THEN** left chevron SHALL appear ghosted (non-interactive, reduced opacity) and SHALL NOT respond to clicks

#### Scenario: Right chevron is ghosted at last item
- **WHEN** user is reading the last item in the filtered results
- **THEN** right chevron SHALL appear ghosted (non-interactive, reduced opacity) and SHALL NOT respond to clicks

#### Scenario: Both chevrons hidden when only one item exists
- **WHEN** the filtered results contain only one article
- **THEN** neither chevron SHALL appear

#### Scenario: Clicking chevron navigates to prev/next article
- **WHEN** user clicks a non-ghosted chevron
- **THEN** the article SHALL navigate to the corresponding prev/next item using the same path as j/k keyboard navigation

### Requirement: Mobile chevron navigation
Reading view SHALL display ◀ and ▶ chevrons in the sticky chrome on mobile/touch viewports when there are prev/next articles available. Chevrons SHALL be placed between the back arrow and the action buttons. Chevrons SHALL be ghosted at boundaries.

#### Scenario: Chevrons appear in chrome on mobile
- **WHEN** user opens an article in reading view on a narrow viewport and there are items on both sides
- **THEN** ◀ and ▶ chevrons SHALL appear in the sticky chrome between the back arrow and action buttons

#### Scenario: Ghosted at boundaries on mobile
- **WHEN** user is at the first or last item on mobile
- **THEN** the corresponding chevron SHALL appear ghosted (non-interactive)

### Requirement: Chrome simplification
The sticky reading chrome SHALL display only a back arrow (no text), a flex spacer, and action buttons (star, open original, shortcuts). Feed name and relative time SHALL NOT appear in the chrome.

#### Scenario: Chrome shows back arrow only (no "All" text)
- **WHEN** user is in reading view
- **THEN** the leftmost chrome element SHALL be a back arrow icon with no accompanying text label

#### Scenario: No feed name or relative time in chrome
- **WHEN** user is in reading view
- **THEN** the chrome SHALL NOT display the feed name or relative time

### Requirement: Byline shows feed name and human-readable relative time
The body byline beneath the article title SHALL display: author (if available), feed name, and human-readable relative time. The relative time SHALL use decaying precision: "2h ago" for <24h, "last Wednesday" / "Wednesday" for <7d, "last month" for <60d, "Jun 2026" for older.

#### Scenario: Byline shows author, feed name, and relative time
- **WHEN** an article is displayed in reading view and has an author
- **THEN** the byline SHALL read `by {author} · {feedName} · {relativeTime}`

#### Scenario: Byline omits author when missing
- **WHEN** an article is displayed without an author
- **THEN** the byline SHALL read `{feedName} · {relativeTime}`

#### Scenario: Relative time shows hours for recent items
- **WHEN** an article was published less than 24 hours ago
- **THEN** the relative time SHALL display as "{N}h ago"

#### Scenario: Relative time shows day name for recent days
- **WHEN** an article was published between 24 hours and 7 days ago
- **THEN** the relative time SHALL display as "last {DayName}" or "{DayName}" as appropriate

#### Scenario: Relative time shows month for recent month
- **WHEN** an article was published between 7 and 60 days ago
- **THEN** the relative time SHALL display as "last month" or "{N} months ago"

#### Scenario: Relative time shows month/year for older items
- **WHEN** an article was published more than 60 days ago
- **THEN** the relative time SHALL display as "{Month} {Year}" (e.g. "Jun 2026")
