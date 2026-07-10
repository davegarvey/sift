## ADDED Requirements

### Requirement: Forward navigation restores reading view
When the user navigates forward in the browser after returning from an article to the river, the system SHALL restore the reading view for the article identified by the URL path.

#### Scenario: Forward from river to article restores reading view
- **WHEN** the user is on the river view and the browser fires a `popstate` event with a URL matching `/i/<hash>`
- **THEN** the system SHALL find the item whose `hashId` matches `<hash>` in the current items list
- **THEN** the system SHALL switch to the reading view displaying that item
- **THEN** the system SHALL NOT push an additional history entry

#### Scenario: Forward to unknown article stays on river
- **WHEN** the user is on the river view and the browser fires a `popstate` event with a URL matching `/i/<hash>`
- **AND** no item with matching `hashId` exists in the current items list
- **THEN** the system SHALL remain on the river view
