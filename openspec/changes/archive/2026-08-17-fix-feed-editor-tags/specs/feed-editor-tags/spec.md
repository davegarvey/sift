## ADDED Requirements

### Requirement: Feed Editor tag add/remove with immediate feedback
The Feed Editor modal SHALL provide responsive tag editing where pressing Enter adds a tag chip immediately and clicking the remove button (✕) removes it immediately, with persistence happening asynchronously.

#### Scenario: Add tag via Enter key
- **WHEN** user types a tag name in the TagInput field and presses Enter
- **THEN** the tag chip appears immediately in the tag chips area
- **AND** the input field clears
- **AND** the tag is persisted to IndexedDB
- **AND** `reloadFeeds()` is called to update the in-memory feed map

#### Scenario: Remove tag via click
- **WHEN** user clicks the ✕ button on an existing tag chip
- **THEN** the tag chip is removed from the UI immediately
- **AND** the updated tags array is persisted to IndexedDB
- **AND** `reloadFeeds()` is called to update the in-memory feed map

#### Scenario: Duplicate tag prevented
- **WHEN** user types a tag name that already exists in the feed's tags (case-insensitive) and presses Enter
- **THEN** no tag chip is added
- **AND** the input field clears
- **AND** no write to IndexedDB occurs

### Requirement: Tag persistence survives modal close/re-open
Tags added or removed in the Feed Editor modal SHALL be correctly restored when the modal is closed and re-opened.

#### Scenario: Re-open modal shows saved tags
- **WHEN** user opens the Feed Editor modal, adds a tag, closes the modal, then re-opens it
- **THEN** the tag added in the previous session appears as a tag chip

### Requirement: Debounced tag save
Tag persistence SHALL be debounced to coalesce rapid add/remove operations into a single save.

#### Scenario: Rapid tag adds coalesced
- **WHEN** user adds three tags in quick succession (<500ms apart)
- **THEN** the tags appear in the UI immediately after each add
- **AND** only one IndexedDB write occurs (or a bounded small number) after the last add

#### Scenario: Tags saved before modal close
- **WHEN** user adds a tag and closes the modal
- **THEN** the in-flight debounced save SHALL be flushed before the modal unmounts

### Requirement: allTags suggestions include newly added tags
The autocomplete suggestions list SHALL include tags added in the current session.

#### Scenario: New tag appears in suggestions
- **WHEN** user adds tag "news" to feed A, then opens the Feed Editor for feed B and types "n" in the TagInput
- **THEN** "news" appears in the suggestion dropdown

### Requirement: TagInput does not steal focus on mount
The TagInput component SHALL NOT auto-focus its input field when the Feed Editor modal opens.

#### Scenario: Title input receives initial focus
- **WHEN** the Feed Editor modal opens
- **THEN** no input field is auto-focused (the user clicks to focus)

### Requirement: Dead code removed
Unused imports and functions in `FeedEditorModal.tsx` SHALL be removed.

#### Scenario: Unused import removed
- **WHEN** inspecting `FeedEditorModal.tsx`
- **THEN** the `updateFeedTags` import from `../feeds/service` SHALL NOT be present

#### Scenario: Unused function removed
- **WHEN** inspecting `FeedEditorModal.tsx`
- **THEN** the `feedTitle` function SHALL NOT be present
