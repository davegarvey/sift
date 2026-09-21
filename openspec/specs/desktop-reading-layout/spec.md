# desktop-reading-layout Specification

## Purpose
Lets desktop readers keep feed navigation and the article queue visible beside the article, while retaining an optional focus layout for distraction-free reading.

## Requirements

### Requirement: Desktop reading keeps feed and article context visible

When the viewport has room for the desktop reading workspace, opening an article SHALL keep the existing feed navigation, a separate article-list pane, and the article reader visible together. The feed navigation SHALL retain its existing organization and controls. Selecting an article SHALL replace the reader content without leaving the workspace.

#### Scenario: Open an article in the desktop workspace
- **WHEN** the user opens an article from the article list in the desktop workspace
- **THEN** the feed navigation, article list, and selected article remain visible in separate panes

#### Scenario: Open a different article
- **WHEN** the user selects another article in the visible article list
- **THEN** the reader displays the newly selected article without returning to the river-only view

#### Scenario: Change the feed while reading
- **WHEN** the user selects a different feed in the visible feed navigation
- **THEN** the article list updates to that feed without leaving the desktop workspace
- **AND** the currently open article remains visible until the user selects another article

### Requirement: Article-list pane has a bounded, persistent width

The article-list pane SHALL be resizable independently of the feed navigation. When the user has not selected a width, its default desktop width SHALL be 30% of the viewport width, bounded between 360 and 560 CSS pixels. A user-selected width SHALL be bounded between 360 and 720 CSS pixels, saved locally, and restored on later visits. When the viewport cannot fit the saved width alongside the other panes, the rendered width SHALL be constrained to preserve usable space for the reader without overwriting the saved preference. A saved width equal to the former 720 CSS pixel default SHALL be treated as an unset preference unless it was explicitly selected.

#### Scenario: Default width adapts to a laptop viewport
- **WHEN** the user has not previously resized the article-list pane
- **AND** the viewport is 1280 CSS pixels wide
- **THEN** the article-list pane is 384 CSS pixels wide

#### Scenario: Default width adapts to a standard desktop viewport
- **WHEN** the user has not previously resized the article-list pane
- **AND** the viewport is 1440 CSS pixels wide
- **THEN** the article-list pane is 432 CSS pixels wide

#### Scenario: Default width is capped on a wide viewport
- **WHEN** the user has not previously resized the article-list pane
- **AND** the viewport is 1920 CSS pixels wide or wider
- **THEN** the article-list pane is 560 CSS pixels wide

#### Scenario: Default width does not fall below the minimum
- **WHEN** the user has not previously resized the article-list pane
- **AND** 30% of the viewport width is less than 360 CSS pixels
- **THEN** the article-list pane is 360 CSS pixels wide

#### Scenario: Resize the article list
- **WHEN** the user resizes the article-list pane within its bounds
- **THEN** the pane changes width independently of the feed navigation
- **AND** the selected width is saved locally

#### Scenario: Resize bounds are enforced
- **WHEN** the user attempts to resize the article-list pane below 360 or above 720 CSS pixels
- **THEN** the pane remains within those bounds

#### Scenario: Narrow viewport constrains a saved width
- **WHEN** the viewport cannot accommodate the saved article-list width and a usable reader pane
- **THEN** the rendered article-list width is reduced to fit the available space
- **AND** the saved user-selected width remains unchanged

### Requirement: Desktop panes adapt to available width

The desktop workspace SHALL keep the article list separate from both the feed navigation and the reader. At intermediate widths, the feed navigation MAY use its existing collapsed presentation while the article list and reader remain separate. When the viewport is too narrow to preserve usable article-list and reader panes, the app SHALL use the existing single-column article/river flow. The existing mobile single-column behavior SHALL remain in effect at viewport widths of 768 CSS pixels or narrower.

#### Scenario: Intermediate desktop width
- **WHEN** the viewport can accommodate the article list and reader but not the expanded feed navigation
- **THEN** the feed navigation uses its existing collapsed presentation
- **AND** the article list remains a pane separate from the reader

#### Scenario: Insufficient width for separate list and reader
- **WHEN** the viewport cannot accommodate usable article-list and reader panes together
- **THEN** the app uses the existing single-column article/river flow

#### Scenario: Mobile layout is unchanged
- **WHEN** the viewport is 768 CSS pixels wide or narrower
- **THEN** opening an article uses the existing single-column reading flow
- **AND** the feed navigation remains available through its existing mobile drawer behavior

### Requirement: Focus mode is an optional persistent desktop layout

The desktop reader toolbar SHALL provide an icon-only focus-mode toggle. When focus mode is disabled, its tooltip SHALL read “Enable focus mode”; when enabled, its tooltip SHALL read “Disable focus mode”. Enabling focus mode SHALL hide the feed navigation and article list while keeping the current article open. In focus mode, a back button SHALL close the article and return to the river without changing the saved focus-mode preference. Disabling focus mode SHALL restore the desktop panes without changing their saved widths. The focus-mode preference SHALL be saved locally until the user toggles it off. The focus-mode toggle SHALL NOT be shown in the mobile single-column flow, where article-only reading is already the default.

#### Scenario: First desktop use defaults to panes visible
- **WHEN** the user has no saved focus-mode preference
- **THEN** the desktop workspace shows the feed navigation, article list, and reader
- **AND** the focus-mode toggle tooltip reads “Enable focus mode”

#### Scenario: Enable focus mode
- **WHEN** the user activates the focus-mode toggle while desktop panes are visible
- **THEN** the feed navigation and article list are hidden
- **AND** the current article remains open in the expanded reader
- **AND** the toggle tooltip reads “Disable focus mode”

#### Scenario: Disable focus mode
- **WHEN** the user activates the focus-mode toggle while focus mode is enabled
- **THEN** the feed navigation and article list are restored
- **AND** the current article remains open
- **AND** the toggle tooltip reads “Enable focus mode”

#### Scenario: Return to the river from focus mode
- **WHEN** the user activates the back button while reading in focus mode
- **THEN** the article closes and the river view appears
- **AND** the saved focus-mode preference remains enabled

#### Scenario: Restore focus preference on a later visit
- **WHEN** the user previously enabled focus mode and returns to Sift on the same device
- **THEN** the desktop reader opens with focus mode enabled until the user disables it

#### Scenario: Focus preference does not alter mobile navigation
- **WHEN** the viewport is 768 CSS pixels wide or narrower
- **THEN** the existing mobile single-column reading flow is used regardless of the saved desktop focus preference
- **AND** no focus-mode toggle is shown

### Requirement: Focus-mode toggle visibly indicates the active state

The desktop focus-mode toggle SHALL use a persistent visual highlight while focus mode is enabled, including when the control is neither hovered nor focused. When focus mode is disabled, the toggle SHALL use its neutral idle appearance. The active treatment SHALL use neutral theme colors rather than the reserved mauve unread/selection accent.

#### Scenario: Enabled toggle remains highlighted at rest

- **WHEN** focus mode is enabled and the toggle is neither hovered nor focused
- **THEN** the toggle displays its active visual highlight
- **AND** the focus-mode state remains clear without relying on the tooltip

#### Scenario: Disabled toggle has no active highlight at rest

- **WHEN** focus mode is disabled and the toggle is neither hovered nor focused
- **THEN** the toggle displays its neutral idle appearance without the active highlight
