## ADDED Requirements

### Requirement: Feed title is editable in the editor modal
The feed editor modal SHALL display the feed title in an editable text input. Changes SHALL save with a 500ms debounce. The input SHALL be pre-filled with the current title value.

#### Scenario: Edit feed title
- **WHEN** the user opens the feed editor modal
- **THEN** the title SHALL appear in a text input pre-filled with the current value
- **AND** typing in the input SHALL update a local signal immediately

#### Scenario: Title saves after debounce
- **WHEN** the user types in the title field and stops typing for 500ms
- **THEN** the new title SHALL be persisted to IndexedDB
- **AND** a feed-upsert sync entry SHALL be enqueued with the new title
- **AND** the sidebar SHALL update to show the new title

### Requirement: Feed URL is editable in the editor modal
The feed editor modal SHALL display the feed URL in an editable text input. Changes SHALL validate and save on blur. The input SHALL be pre-filled with the current URL value.

#### Scenario: Edit feed URL to a valid, new URL
- **WHEN** the user changes the URL field and moves focus away (blur)
- **THEN** the new URL SHALL be validated as a valid HTTP(S) URL
- **AND** the system SHALL check that the new URL is not already subscribed
- **AND** the feed's `url` field SHALL be updated
- **AND** the feed's `etag` and `lastModified` SHALL be cleared
- **AND** a feed-upsert sync entry SHALL be enqueued with the new URL

#### Scenario: Edit feed URL to an invalid URL
- **WHEN** the user enters an invalid URL (not a valid URL format) and blurs
- **THEN** an inline error SHALL be displayed
- **AND** the URL SHALL NOT be saved

#### Scenario: Edit feed URL to an already-subscribed URL
- **WHEN** the user enters a URL that is already subscribed to and blurs
- **THEN** an inline error SHALL be displayed indicating the feed already exists
- **AND** the URL SHALL NOT be saved

#### Scenario: URL unchanged on blur
- **WHEN** the user focuses the URL field, makes no change, and blurs
- **THEN** no save or validation SHALL occur

### Requirement: Tags save immediately per change
The tag input SHALL retain its existing immediate-save behavior. Each chip add or remove SHALL immediately persist to IndexedDB and enqueue a sync entry.

#### Scenario: Add tag saves immediately
- **WHEN** the user adds a tag chip
- **THEN** the tag SHALL be immediately persisted to IndexedDB
- **AND** a feed-upsert sync entry SHALL be enqueued

#### Scenario: Remove tag saves immediately
- **WHEN** the user removes a tag chip
- **THEN** the tag change SHALL be immediately persisted to IndexedDB
- **AND** a feed-upsert sync entry SHALL be enqueued
