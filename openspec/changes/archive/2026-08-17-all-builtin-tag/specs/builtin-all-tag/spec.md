## ADDED Requirements

### Requirement: Builtin `all` tag is always present in the sidebar

The system SHALL provide a built-in tag named `all` that is always visible as the first chip in the sidebar tag chips row, regardless of how many user-defined tags exist.

The `all` tag SHALL NOT be stored on any `Feed` record and SHALL NOT appear in `allTags()` — it is injected at render time.

#### Scenario: Tag chips visible with no user tags
- **WHEN** the user has not created any tags
- **THEN** the sidebar tag chips row SHALL be visible and contain only the `all` chip

#### Scenario: Tag chips visible with user tags
- **WHEN** the user has created one or more tags
- **THEN** the sidebar tag chips row SHALL show the `all` chip first, followed by user-defined tags

#### Scenario: `all` excluded from allTags derived signal
- **WHEN** the app computes `allTags()` from feed records
- **THEN** `all` SHALL NOT be included in the result

### Requirement: Selecting `all` shows all items

When the user clicks the `all` tag chip, the system SHALL clear any active tag filters, set the view scope to all feeds, and display all items — identical to the current "All Feeds" behaviour.

#### Scenario: Click all with active tag
- **WHEN** a tag filter is active and the user clicks the `all` chip
- **THEN** the active tag filter SHALL be cleared
- **THEN** the river SHALL display items from all feeds
- **THEN** the `all` chip SHALL appear active (styled with `.active` class)
- **THEN** all other chips SHALL appear inactive

#### Scenario: Click all when already viewing all
- **WHEN** the user is currently viewing all items and clicks the `all` chip
- **THEN** the view SHALL remain unchanged (no-op)

#### Scenario: all chip active state
- **WHEN** `riverScope` is `null` and `activeTags` is empty
- **THEN** the `all` chip SHALL have the `.active` CSS class

### Requirement: Tag name `all` is reserved

The system SHALL prevent users from creating or assigning a tag with the name `all` (case-insensitive, after normalization). This applies to every tag input path: the add-feed modal, the feed editor modal, and any future tag entry point.

#### Scenario: Reject all in TagInput add
- **WHEN** a user types `all` (or `All`, `ALL`, ` aLL  `) into a TagInput field and presses Enter or comma
- **THEN** the tag SHALL NOT be added
- **THEN** the input SHALL be cleared (normal no-op behaviour for rejected tags)

#### Scenario: Reject all in autocomplete selection
- **WHEN** a user sees `all` in a TagInput autocomplete suggestion list and clicks it
- **THEN** the tag SHALL NOT be added

#### Scenario: Reserved name check is centralized
- **WHEN** `normalizeTag` receives a string that normalizes to `all`
- **THEN** it SHALL return `null` to indicate a reserved name

#### Scenario: Existing tag named all still functions
- **WHEN** a feed already has a tag that normalizes to `all` (e.g., from before this change)
- **THEN** the feed SHALL retain that tag in its `tags` array
- **THEN** the tag SHALL still function as a normal filter tag (OR semantics)
- **THEN** the user SHALL NOT be able to add a new tag named `all` to any feed
- **THEN** if the user edits the feed and removes the `all` tag, they SHALL NOT be able to re-add it

### Requirement: Remove "All Feeds" sidebar row

The system SHALL remove the dedicated "All Feeds" row from the sidebar, along with its `selectAllFeeds` handler function and the `all-feeds` CSS class.

#### Scenario: All Feeds row absent
- **WHEN** the sidebar is rendered
- **THEN** there SHALL be no element with class `all-feeds` and no element containing the text "All Feeds"

### Requirement: Sidebar feed list respects tag filters (unchanged)

When the `all` chip is active (no tag filter), all feeds SHALL appear in the sidebar feed list. When any user-defined tag chip is active, the feed list SHALL be filtered to only feeds matching the active tags (OR semantics). This behaviour is unchanged.

#### Scenario: all chip shows all feeds
- **WHEN** the `all` chip is active (no tag filter)
- **THEN** all subscribed feeds SHALL appear in the sidebar feed list

#### Scenario: User tag filters feeds
- **WHEN** a user-defined tag chip is active
- **THEN** only feeds with that tag SHALL appear in the sidebar feed list

### Requirement: River visibleItems logic (unchanged)

The `visibleItems` computed signal in the River component SHALL continue to use the same precedence:
1. If `activeTags.length > 0`: filter items by feeds matching those tags
2. Else if `riverScope != null`: filter items to that feed
3. Else: show all items (the `all` state)

This behaviour requires no changes.

#### Scenario: all tag shows all items via existing code path
- **WHEN** `activeTags` is empty and `riverScope` is `null`
- **THEN** `visibleItems` SHALL return all items (no change)
