# reader-ui Specification

## Purpose
TBD - created by archiving change fix-swipe-scroll-jitter. Update Purpose after archive.
## Requirements
### Requirement: River swipe does not engage during vertical scroll
On touch devices, the river swipe-to-reveal gesture SHALL NOT engage as a result of vertical scrolling. The touched row SHALL remain at its resting position while the user scrolls the list, and the swipe-reveal CTA SHALL NOT become visible.

#### Scenario: Vertical scroll does not shift a row
- **WHEN** the user scrolls the river vertically on a touch device
- **THEN** the touched row is not translated horizontally
- **AND** the swipe-reveal CTA is not revealed

#### Scenario: Cancelled gesture leaves no stale state
- **WHEN** the browser takes over a vertical pan and dispatches `pointercancel`
- **THEN** the row's inline transform is cleared
- **AND** the `.swiping` class is removed
- **AND** no portion of the colored swipe-reveal CTA remains visible

#### Scenario: Intentional horizontal swipe still works
- **WHEN** the user begins a gesture with horizontal motion exceeding the swipe dead zone
- **THEN** the row follows the finger horizontally
- **AND** releasing past the trigger displacement still commits the mark-read or star action

