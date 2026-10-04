## MODIFIED Requirements

### Requirement: River filter
The river item list SHALL filter to starred-only items when `starredOnly` is true. The filter SHALL compose with existing filters (feed scope, tag selection) as an AND condition.

#### Scenario: Starred filter with no feed/tag scope
- **WHEN** `starredOnly` is true
- **AND** `riverScope` is null
- **AND** `activeTags` is empty
- **THEN** the selected-item query SHALL apply starred eligibility before its result limit and SHALL include read starred articles regardless of the remembered read mode

#### Scenario: Starred filter with feed scope
- **WHEN** `starredOnly` is true
- **AND** `riverScope` is set to a feed ID
- **THEN** only starred items from that feed SHALL be displayed

#### Scenario: Starred filter with tag scope
- **WHEN** `starredOnly` is true
- **AND** `activeTags` has one or more tags
- **THEN** only starred items from feeds matching those tags SHALL be displayed

