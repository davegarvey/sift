## ADDED Requirements

### Requirement: Tag assignment to feeds
Users SHALL be able to assign one or more tags to any feed. Tags are user-defined string labels. A feed SHALL support zero or more tags.

#### Scenario: Assign tag to feed on subscribe
- **WHEN** user subscribes to a new feed via the AddFeedModal
- **THEN** the tag input SHALL accept text input and create tag chips on comma or Enter
- **THEN** tags SHALL be stored on the Feed record as `tags: string[]`

#### Scenario: Add tag to existing feed
- **WHEN** user opens the feed editor modal for a feed and types a new tag name
- **THEN** the tag SHALL be added to the feed's `tags` array
- **THEN** the tag SHALL appear in the sidebar chip row if it didn't exist before

#### Scenario: Remove tag from feed
- **WHEN** user clicks the `✕` on a tag chip in the feed editor modal
- **THEN** the tag SHALL be removed from that feed's `tags` array
- **THEN** if no other feed has that tag, the tag SHALL disappear from the sidebar chip row

#### Scenario: Autocomplete suggests existing tags
- **WHEN** user types in the tag input (in AddFeedModal or feed editor)
- **THEN** a dropdown SHALL show matching tags from all feeds' tags, deduplicated
- **THEN** user SHALL be able to click a suggestion to add it

#### Scenario: Create new tag via autocomplete
- **WHEN** user types text that doesn't match any existing tag and presses Enter
- **THEN** a new tag with that text SHALL be created and assigned

#### Scenario: Tag with empty string or whitespace-only is rejected
- **WHEN** user attempts to add an empty or whitespace-only tag
- **THEN** the system SHALL ignore the input and not create the tag

#### Scenario: Tag normalization trims whitespace
- **WHEN** user inputs `"  Rust  "` as a tag
- **THEN** the stored tag SHALL be `"rust"` (trimmed, whitespace collapsed, lowercased)

#### Scenario: Tag normalization collapses internal whitespace
- **WHEN** user inputs `"web  dev"` as a tag
- **THEN** the stored tag SHALL be `"web dev"` (internal whitespace collapsed to single space, lowercased)

#### Scenario: Tag normalization prevents case duplicates
- **WHEN** the tag `"rust"` already exists on a feed and user adds `"Rust"`
- **THEN** the addition SHALL be a no-op (normalized comparison matches existing)

#### Scenario: Tag input rejects commas
- **WHEN** user types a comma in the tag input
- **THEN** the input SHALL split on comma, creating separate tags for each segment

#### Scenario: Tag name length limit
- **WHEN** user inputs a tag name longer than 64 characters
- **THEN** the input SHALL be truncated to 64 characters
