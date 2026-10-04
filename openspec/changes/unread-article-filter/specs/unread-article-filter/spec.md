## ADDED Requirements

### Requirement: Remembered scoped article filter
The app SHALL offer Unread and All modes, defaulting to All when no active preference is stored. It SHALL persist the choice on the device, preserve it across feed/tag selection changes and apply it within the existing selection. Deprecated settings from the removed filter SHALL NOT silently change the initial default.

#### Scenario: Choose unread and change feeds
- **WHEN** the reader chooses Unread and selects another feed or tag
- **THEN** only unread articles within that selection SHALL be listed
- **AND** reopening the app SHALL restore Unread

#### Scenario: View starred articles
- **WHEN** Starred is active
- **THEN** the control SHALL be hidden and both read and unread starred articles SHALL be eligible within the current feed/tag selection
- **AND** disabling Starred SHALL restore the remembered Unread / All mode

### Requirement: Standalone responsive control
The desktop control SHALL float above the article content, aligned to the right edge of the list, without a repeated feed/tag heading or full-width toolbar divider. In desktop reading view it SHALL remain above the middle article-list column. On mobile it SHALL occupy the existing top header alongside the wordmark, without an additional control row above the list. Controls SHALL have accessible names, expose selection state and support keyboard and touch activation.

#### Scenario: Open an article on desktop
- **WHEN** the reader opens an article
- **THEN** the control SHALL remain associated with the list column rather than the article body

#### Scenario: Browse on mobile
- **WHEN** the mobile article list is visible
- **THEN** Unread / All SHALL appear at the right of the top header
- **AND** article content SHALL begin below that header without a separate filter row

### Requirement: Stable reading transitions
Opening an unread article SHALL retain that article's row and position while it is the current reading item, even after it is marked read or the list reloads. In Unread mode, moving to another article or returning to the list SHALL release the retained row and exclude it if read. Navigation SHALL use the same ordered eligible articles as the visible list, rather than unfiltered indices.

#### Scenario: Read and move forward
- **WHEN** an unread article is opened in Unread mode
- **THEN** its row SHALL stay visible while reading
- **AND** moving forward SHALL open the next eligible unread article and remove the previous read row

#### Scenario: Return to the mobile list
- **WHEN** the reader returns from an article now marked read in Unread mode
- **THEN** that article SHALL no longer appear in the list
- **AND** focus SHALL follow the remaining-neighbour rule

### Requirement: Filter before limiting results
Item queries SHALL apply feed/tag scope, effective read mode and starred eligibility before the 500-item result limit and SHALL order eligible articles newest first. The retained current reading row SHALL NOT displace an eligible unread result.

#### Scenario: Older unread articles behind read articles
- **GIVEN** the latest 500 stored articles are read and an older matching article is unread
- **WHEN** Unread is selected
- **THEN** the older unread article SHALL be available in the list
