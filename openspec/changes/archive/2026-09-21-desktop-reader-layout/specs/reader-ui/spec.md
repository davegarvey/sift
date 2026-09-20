## MODIFIED Requirements

### Requirement: Back CTA remains in the top-left chrome

Reading view SHALL keep a back button as the leftmost element of the top chrome when the app uses the single-column reading flow and the article list is not visible. When the desktop reading workspace is visible, reading view SHALL NOT show a back CTA; the user can select another article from the adjacent list. In desktop focus mode, the focus-mode toggle SHALL remain available to restore the panes. No separate close-article CTA SHALL be shown in the desktop workspace.

#### Scenario: Back button in top chrome
- **WHEN** the user is in the single-column mobile reading flow
- **THEN** a back button is displayed at the top-left of the reading chrome

#### Scenario: Back returns to the river
- **WHEN** the user activates the back button in the mobile reading flow
- **THEN** the app returns to the river view, same as today

#### Scenario: Desktop workspace omits the back CTA
- **WHEN** the desktop reading workspace shows the feed navigation and article list beside the reader
- **THEN** the reading chrome does not display a back CTA
- **AND** selecting another article replaces the current reader content in place

#### Scenario: Focus mode remains reversible without a back CTA
- **WHEN** the user is reading in desktop focus mode
- **THEN** the reading chrome does not display a back CTA or a separate close-article CTA
- **AND** the focus-mode toggle restores the feed navigation and article list

#### Scenario: Compact single-column fallback retains a way back
- **WHEN** the viewport is too narrow to show the article list and reader as separate panes
- **THEN** the single-column reading view displays a back button in the top-left chrome
