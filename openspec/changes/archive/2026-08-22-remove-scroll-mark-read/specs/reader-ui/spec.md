## MODIFIED Requirements

### Requirement: Implicit mark-as-read on open and on scroll
Opening an item SHALL mark it read immediately. Scrolling an item fully out of the river viewport SHALL mark it read after a short delay. These behaviors are defaults and may be disabled in settings.

#### Scenario: User opens an unread item
- **WHEN** the user opens an unread item into reading view
- **THEN** the item's `read` state is set to true immediately on open
