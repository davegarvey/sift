## MODIFIED Requirements

### Requirement: Default view is a reverse-chronological river of unread items
The app SHALL open directly into a river view. The default mode lists unread items across all subscribed feeds in reverse-chronological order ("Unread" mode). The user may switch to "All" mode via the sidebar, which includes read items. The river must not be hidden behind navigation. The last selected mode is persisted and restored on boot.

#### Scenario: App opens with unread items available
- **WHEN** the app boots and IndexedDB contains unread items
- **THEN** the river is rendered immediately with the most recent item at the top

#### Scenario: App opens with no unread items
- **WHEN** the app boots and IndexedDB contains no unread items
- **THEN** an empty state is rendered with the message "You're all caught up." and a subtle "Check for new items" affordance

#### Scenario: User switches to All mode
- **WHEN** the user selects "All" in the sidebar
- **THEN** the river displays all items (read and unread) across all subscribed feeds in reverse-chronological order, with read items visually distinguished by dimmed titles and no accent dot

#### Scenario: User navigates back to the river from reading view
- **WHEN** the user presses `Esc`, the back gesture, or the browser back button while in reading view
- **THEN** the river is shown in the current sidebar mode (Unread or All) at the same scroll position the user left

### Requirement: Empty state is shown without hiding the app
When no items match the current view, the river SHALL display a contextual empty state. In "Unread" mode, the empty state reads "You're all caught up." with a "Check for new items" affordance. In "All" mode, an empty state only appears when IndexedDB contains no items at all (fresh install). The app SHALL NOT hide navigation or chrome in any empty state.

#### Scenario: No unread items in Unread mode
- **WHEN** the user is in "Unread" mode and IndexedDB contains no unread items
- **THEN** the river body shows "You're all caught up." and a "Check for new items" link below it

#### Scenario: Zero items in All mode (fresh install)
- **WHEN** the user is in "All" mode and IndexedDB contains no items
- **THEN** the river body shows an empty state describing that no feeds are subscribed

## ADDED Requirements

### Requirement: Sidebar contains Unread and All entries
The sidebar SHALL contain "Unread" and "All" entries at the top, before any feed entries, acting as view selectors for the river's read filter mode. The currently active entry SHALL be highlighted with the accent left-border. "Unread" SHALL display a badge with the total unread count across all feeds. "All" SHALL NOT display a count badge.

#### Scenario: User selects the Unread view
- **WHEN** the user clicks the "Unread" entry in the sidebar
- **THEN** the river scope resets to all feeds and the read filter switches to unread-only
- **AND** the "Unread" entry is highlighted as active
- **AND** the selection is persisted for the next app boot

#### Scenario: User selects the All view
- **WHEN** the user clicks the "All" entry in the sidebar
- **THEN** the river scope resets to all feeds and the read filter switches to show all items
- **AND** the "All" entry is highlighted as active
- **AND** the selection is persisted for the next app boot

#### Scenario: Feed entries respect the current read filter
- **WHEN** the user clicks a feed entry in the sidebar while in "All" mode
- **THEN** the river displays all items from that feed (read and unread)
- **WHEN** the user clicks a feed entry while in "Unread" mode
- **THEN** the river displays only unread items from that feed

#### Scenario: Feed entries are unaffected by mode
- **WHEN** the sidebar displays feed entries
- **THEN** each feed entry always displays its feed-specific unread count badge, regardless of the current read filter mode

### Requirement: Last selected sidebar view is persisted
The app SHALL persist the last selected sidebar entry (Unread, All, or a specific feed) in IndexedDB and restore it on the next app boot. The default for new users is "Unread" (all feeds, unread-only).

#### Scenario: App boots and restores previous sidebar selection
- **WHEN** the app boots and a previous sidebar selection exists in storage
- **THEN** the river is rendered in the restored mode (read filter + feed scope)
- **AND** the corresponding sidebar entry is highlighted as active

#### Scenario: New user boots for the first time
- **WHEN** the app boots and no sidebar selection has been persisted
- **THEN** the river defaults to "Unread" mode (all feeds, unread-only)
- **AND** "Unread" is highlighted as the active sidebar entry
