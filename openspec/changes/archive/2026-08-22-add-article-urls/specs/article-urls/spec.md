## ADDED Requirements

### Requirement: URL updates on article open

When the user opens an article for reading, the browser URL SHALL update to reflect the current article. Navigating between articles within the reading view SHALL update the URL without creating additional history entries.

#### Scenario: Opening article pushes history entry
- **WHEN** the user opens an article from the river view
- **THEN** the URL changes to `/i/<encoded-id>/<optional-slug>` and a new history entry is created

#### Scenario: Navigating between articles replaces history entry
- **WHEN** the user navigates to a different article using the prev/next controls (j/k) while in the reading view
- **THEN** the URL updates to the new article's URL using `replaceState`

#### Scenario: URL format includes encoded composite ID
- **WHEN** the user opens any article
- **THEN** the URL SHALL contain a URL-safe encoded form of the item's composite ID (`feedUrl::guid`) as the first path segment after `/i/`
- **AND** the encoding SHALL be reversible (base64url)

#### Scenario: URL includes cosmetic title slug
- **WHEN** the user opens an article with a non-empty title
- **THEN** the URL SHALL contain a slugified version of the article title as the second path segment
- **AND** the slug SHALL be derived from the title by lowercasing, replacing non-alphanumeric characters with hyphens, collapsing consecutive hyphens, and truncating to 80 characters

#### Scenario: Slug is ignored during navigation
- **WHEN** the user opens an article via a URL where the slug is incorrect, missing, or stale
- **THEN** the article SHALL still open correctly based solely on the encoded ID

### Requirement: URL restoration on page load

On app boot, the URL SHALL be inspected. If it contains an article reference, the app SHALL attempt to restore the reading view with that article.

#### Scenario: Loading page with valid article URL
- **WHEN** the user loads the app and the URL contains a valid, decodable article ID
- **AND** an item with that ID exists in IndexedDB
- **THEN** the app SHALL directly open the reading view displaying that article

#### Scenario: Loading page with unknown or evicted article
- **WHEN** the user loads the app with an article URL whose ID does not exist in IndexedDB
- **THEN** the app SHALL display the river view without error

#### Scenario: Loading page without article URL
- **WHEN** the user loads the app and the URL is `/` or does not match the article URL pattern
- **THEN** the app SHALL display the river view as normal

### Requirement: URL cleanup on closing reading view

When the user closes the reading view, the URL SHALL return to the previous state.

#### Scenario: Closing reading view via Escape or back button
- **WHEN** the user presses Escape or clicks the back button in the reading chrome
- **THEN** the URL SHALL return to the river view URL via `history.back()`

#### Scenario: Closing reading view via browser back
- **WHEN** the user presses the browser back button while in the reading view
- **THEN** the reading view SHALL close and the river view SHALL be displayed
