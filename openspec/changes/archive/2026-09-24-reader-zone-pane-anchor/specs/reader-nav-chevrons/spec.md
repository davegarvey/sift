## MODIFIED Requirements

### Requirement: Desktop chevron navigation
Reading view SHALL display ◀ and ▶ chevrons in the left and right margin gutters respectively when there are prev/next articles available. Chevrons SHALL be vertically centered in the viewport. The margin strip from the reader pane's edge to the content edge SHALL act as the click/tap hit zone. Hit zones SHALL NOT extend beyond the reader pane or intercept input to adjacent panes such as the sidebar or article list. Chevrons SHALL be non-interactive (ghosted) at the first/last boundary and SHALL NOT appear when there is only one item in results.

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

#### Scenario: Hit zone stays within the reader in the desktop workspace
- **GIVEN** the sidebar and article list are shown beside the reader
- **WHEN** user clicks or hovers anywhere in the sidebar or article list
- **THEN** the input SHALL reach that pane and SHALL NOT trigger chevron navigation
