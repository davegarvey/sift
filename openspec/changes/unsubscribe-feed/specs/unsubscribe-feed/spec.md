## ADDED Requirements

### Requirement: User can unsubscribe from a feed via the sidebar
Each feed row in the sidebar SHALL display an unsubscribe button (`×`) that removes the feed and all its items from IndexedDB after confirmation. On devices that support hover (`@media (hover: hover)`), the button SHALL be hidden by default and revealed on row hover. On touch-only devices, the button SHALL be always visible.

#### Scenario: Desktop user hovers over a feed row
- **WHEN** the user hovers over a feed row on a hover-capable device
- **THEN** the unsubscribe button becomes visible alongside the feed title

#### Scenario: Mobile user views a feed row
- **WHEN** the user views a feed row on a touch-only device
- **THEN** the unsubscribe button is always visible

#### Scenario: User clicks the unsubscribe button
- **WHEN** the user clicks the `×` button on a feed row
- **THEN** a confirmation modal is displayed showing "Unsubscribe from [feed title]?" and "This will remove the feed and all its items." with Cancel and Confirm buttons
- **AND** clicking Cancel dismisses the modal without deleting anything

#### Scenario: User confirms unsubscription
- **WHEN** the user clicks Confirm in the unsubscribe modal
- **THEN** all items belonging to that feed are deleted from IndexedDB
- **AND** the feed itself is deleted from IndexedDB
- **AND** the sidebar and river are updated to reflect the removal
- **AND** if the deleted feed was the currently selected feed, the river scope resets to show all feeds
- **AND** the user cannot undo this action

#### Scenario: User confirms unsubscription of an actively fetching feed
- **WHEN** the user unsubscribes from a feed that is currently being refreshed
- **THEN** the feed and its items are still deleted
- **AND** any in-flight refresh for that feed becomes a no-op (the feed no longer exists to receive updates)

### Requirement: Add-feed button is accessible from the topbar
The app SHALL provide an add-feed button in the topbar, placed as a `+` icon button alongside the existing refresh and settings buttons. Clicking it SHALL open the existing AddFeedModal. The standalone add-feed pill at the bottom of the sidebar SHALL be removed.

#### Scenario: User clicks the add-feed button in the topbar
- **WHEN** the user clicks the `+` (add feed) icon button in the topbar
- **THEN** the AddFeedModal opens
- **AND** the behavior is identical to the previous sidebar add-feed interaction

#### Scenario: Sidebar no longer shows the add-feed button
- **WHEN** the sidebar is rendered
- **THEN** no add-feed affordance appears at the bottom of the sidebar
