# unread-article-filter Specification

## Purpose
Let readers choose between unread and all articles within the selected feeds or tags, remember that choice per device, and keep reading navigation stable as articles are marked read.

## Requirements

### Requirement: Remembered scoped article filter
The app SHALL offer Unread and All modes, defaulting to All when no active preference is stored. It SHALL persist the choice on the device, preserve it across feed/tag selection changes and apply it within the existing selection. Deprecated settings from the removed filter SHALL NOT silently change the initial default.

#### Scenario: Choose unread and change feeds
- **WHEN** the reader chooses Unread and selects another feed or tag
- **THEN** only unread articles within that selection SHALL be listed
- **AND** reopening the app SHALL restore Unread

#### Scenario: View starred articles
- **WHEN** Starred is active
- **THEN** the control SHALL be disabled and both read and unread starred articles SHALL be eligible within the current feed/tag selection
- **AND** disabling Starred SHALL restore the remembered Unread / All mode

### Requirement: Sidebar filter control
The control SHALL be a single icon toggle (Lucide `CircleDot`) in the sidebar filter chips beside Starred, on desktop and in the mobile sidebar drawer, and in the collapsed desktop sidebar rail beside Starred. Pressed SHALL mean Unread; unpressed SHALL mean All. It SHALL NOT occupy a row above the article list or appear in the mobile top header. While Starred is active the toggle SHALL be disabled and not highlighted. The toggle SHALL have an accessible name, expose its pressed state and support keyboard and touch activation.

#### Scenario: Browse the article list
- **WHEN** the article list is visible on desktop or mobile
- **THEN** the first article SHALL begin directly below the existing chrome without a filter row above it
- **AND** the Unread toggle SHALL appear in the sidebar filter chips, or in the collapsed rail when the desktop sidebar is collapsed

#### Scenario: Starred active
- **WHEN** Starred is active
- **THEN** the Unread toggle SHALL be disabled and SHALL retain the remembered mode for when Starred is disabled

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
