## MODIFIED Requirements

### Requirement: Implicit mark-as-read on open and on scroll
Opening an item SHALL mark it read immediately. Scrolling an item fully out of the river viewport SHALL mark it read after a short delay. These behaviors are defaults and may be disabled in settings.

#### Scenario: User opens an unread item
- **WHEN** the user opens an unread item into reading view
- **THEN** the item's `read` state is set to true immediately on open

## REMOVED Requirements

### Requirement: Implicit mark-as-read on open and on scroll
**Reason**: The scroll-past auto-mark-read behavior was surprising to users — items disappeared from the river without explicit action. Only the explicit on-open mark-read is retained.
**Migration**: Users who relied on scroll-past marking can manually mark items read via the hover-visible read-toggle or swipe-right gesture.

#### Scenario: User scrolls past an item without opening it
- **WHEN** an item scrolls fully out of the visible river viewport
- **AND** the user has not disabled the "mark read on scroll past" setting
- **THEN** the item's `read` state is set to true after a configurable delay (default 500ms)

#### Scenario: User disables mark-read-on-scroll
- **WHEN** the user toggles "Mark items read when I scroll past them" off in settings
- **THEN** scrolling an item out of the river viewport does not change its `read` state
