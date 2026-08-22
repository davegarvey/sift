## ADDED Requirements

### Requirement: Tag chips in sidebar
The sidebar SHALL display an auto-derived row of tag chips between the "Feeds" heading and the "All Feeds" entry. Each unique tag across all subscribed feeds SHALL render as a clickable chip.

#### Scenario: Tag chips appear after tags exist
- **WHEN** at least one feed has at least one tag
- **THEN** the tag chip row SHALL render in the sidebar between "FEEDS" heading and "All Feeds"
- **THEN** each unique tag SHALL appear as one chip

#### Scenario: No tags, no chip row
- **WHEN** no feeds have any tags
- **THEN** the tag chip row SHALL NOT render

#### Scenario: Tag chip entrance animation
- **WHEN** a tag appears in the sidebar for the first time
- **THEN** it SHALL animate in with a fade + slide-up transition (~200ms)

#### Scenario: Tag chip removal
- **WHEN** a tag is removed from the last feed that had it
- **THEN** the chip SHALL be removed from the sidebar

### Requirement: River filtering by tag
The river SHALL filter items to show only those from feeds matching the selected tag(s). Tag filter and feed-scope selection SHALL be mutually exclusive.

#### Scenario: Click tag to filter
- **WHEN** user clicks a tag chip
- **THEN** the river SHALL display items from feeds that have that tag
- **THEN** the feed list SHALL scope to show only matching feeds
- **THEN** the chip SHALL render with active styling
- **THEN** any previously selected feed scope SHALL be cleared

#### Scenario: Multi-tag OR filtering
- **WHEN** user selects a second tag chip
- **THEN** the river SHALL display items from feeds that have EITHER tag (OR semantics)
- **THEN** both chips SHALL render with active styling

#### Scenario: Deselect tag
- **WHEN** user clicks an already-active tag chip
- **THEN** that tag SHALL be deselected
- **THEN** if no tags remain active, the river SHALL return to "All Feeds" mode

#### Scenario: All Feeds resets tag filter
- **WHEN** user clicks "All Feeds" while a tag filter is active
- **THEN** all tag chips SHALL be deselected
- **THEN** the river SHALL display all items
- **THEN** the feed list SHALL show all feeds

#### Scenario: Feed list scoped when tag filter active
- **WHEN** a tag filter is active
- **THEN** the sidebar feed list SHALL show only feeds matching the active tag(s)
- **THEN** non-matching feeds SHALL be hidden from the list

#### Scenario: Feed selection clears tag filter
- **WHEN** user clicks a feed row while a tag filter is active
- **THEN** all tag chips SHALL be deselected
- **THEN** the river SHALL scope to that single feed
