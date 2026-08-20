# reader-ui Specification

## Purpose
TBD - created by archiving change feed-loading-ux. Update Purpose after archive.

## Requirements

### Requirement: Empty state is shown without hiding the app

When no items match the current view, the river SHALL display a contextual empty state OR a loading state. The loading state takes priority when a feed fetch is in progress or while the app is hydrating feeds/items from IndexedDB on startup. The app SHALL NOT hide navigation or chrome in any empty or loading state.

#### Scenario: Feed being fetched — loading message shown

- **GIVEN** a feed that has been subscribed to but not yet fetched (no items in IndexedDB for that feed)
- **WHEN** the feed fetch is in progress
- **THEN** the river SHALL display a "Loading…" message instead of an empty state
- **AND** the message SHALL only become visible once the loading has lasted at least ~500ms, fading in gradually

#### Scenario: Fetch completes — items replace loading message

- **GIVEN** the loading message is displayed
- **WHEN** the feed fetch completes and items are stored
- **THEN** the message SHALL be replaced by the fetched items within the same rendering frame that items are loaded into the reactive state

#### Scenario: No unread items in Unread mode (no fetch in progress)

- **WHEN** the user is in "Unread" mode and IndexedDB contains no unread items
- **AND** no feed fetch is in progress
- **THEN** the river body shows "You're all caught up." and a "Check for new items" link below it (unchanged)

#### Scenario: Zero items in All mode (fresh install, no fetch in progress)

- **WHEN** the user is in "All" mode and IndexedDB contains no items
- **AND** no feed fetch is in progress
- **THEN** the river body shows an empty state describing that no feeds are subscribed (unchanged)

### Requirement: Per-feed fetching indicator in sidebar

The sidebar SHALL indicate when a specific feed is currently being fetched. A small animated spinner SHALL be displayed next to the feed's title while the fetch is in flight. The spinner SHALL be removed when the fetch completes (whether success or error).

#### Scenario: Feed fetch in progress

- **WHEN** a feed subscription is being fetched
- **THEN** a small rotating spinner icon SHALL appear next to that feed's title in the sidebar

#### Scenario: Feed fetch completes

- **WHEN** the feed fetch completes (success or error)
- **THEN** the spinner SHALL be removed from that feed's sidebar entry

#### Scenario: Multiple feeds being fetched simultaneously

- **WHEN** multiple feeds are being fetched concurrently
- **THEN** each feed SHALL independently display its spinner while its own fetch is in flight

### Requirement: Items appear immediately after subscribe fetch

After a user subscribes to a feed, the items SHALL appear in the river as soon as the initial fetch completes, without waiting for the periodic polling interval.

#### Scenario: User subscribes and fetch succeeds

- **WHEN** the user subscribes to a feed
- **AND** the initial feed fetch completes successfully
- **THEN** the items SHALL be loaded into the river within the same tick as the fetch resolution

#### Scenario: User subscribes and fetch fails

- **WHEN** the user subscribes to a feed
- **AND** the initial feed fetch fails
- **THEN** the loading state SHALL be removed
- **AND** the feed SHALL display its error state in the sidebar
- **AND** the river SHALL show the appropriate empty state (feed has no items and fetch failed)

### Requirement: River respects fixed TopBar on mobile
On mobile viewports the river SHALL offset its content below the fixed TopBar so that feed items are not obscured by the navigation bar.

#### Scenario: River content is below the TopBar on mobile
- **WHEN** the viewport is 768px or narrower
- **THEN** the river has padding at the top equal to the TopBar height (40px on non-touch devices, 44px on touch devices)
- **AND** the first feed item is fully visible below the TopBar without scrolling

#### Scenario: Desktop layout is unaffected
- **WHEN** the viewport is wider than 768px
- **THEN** the river has no padding-top for the TopBar

### Requirement: Implicit mark-as-read on open and on scroll
Opening an item SHALL mark it read immediately. The scroll-past auto-mark-read behavior is removed: scrolling an item out of the river viewport SHALL NOT change its `read` state.

#### Scenario: User opens an unread item
- **WHEN** the user opens an unread item into reading view
- **THEN** the item's `read` state is set to true immediately on open

### Requirement: Mobile reading chrome SHALL use a bottom action bar

On mobile viewports (≤768px), reading view SHALL display a fixed bottom action bar containing, in order: prev (far left), star and open (central cluster), next (far right). The prev/next buttons SHALL use the same `hasPrev`/`hasNext` boundary logic as before — disabled/ghosted at first/last item and hidden when only one item exists. The top chrome SHALL NOT display prev/next chevrons on mobile.

#### Scenario: Bottom bar shows on mobile

- **WHEN** the user opens an article in reading view on a viewport ≤768px
- **THEN** a fixed bottom bar is visible with prev (far left), star, open, and next (far right) buttons

#### Scenario: Bottom bar not shown on desktop

- **WHEN** the user opens an article in reading view on a viewport >768px
- **THEN** the bottom action bar SHALL NOT be displayed, and the existing desktop chrome and margin chevrons remain

#### Scenario: Prev button ghosted at first item

- **WHEN** the user is reading the first item in the filtered results on mobile
- **THEN** the bottom-bar prev button is disabled and ghosted

#### Scenario: Next button ghosted at last item

- **WHEN** the user is reading the last item in the filtered results on mobile
- **THEN** the bottom-bar next button is disabled and ghosted

#### Scenario: Prev/next hidden for a single item

- **WHEN** the filtered results contain only one article
- **THEN** neither prev nor next SHALL appear in the bottom bar

#### Scenario: Bottom bar does not obscure article content

- **WHEN** the bottom bar is displayed on mobile
- **THEN** the reading body SHALL have sufficient bottom padding that the last paragraph is not permanently covered by the bar

### Requirement: Back CTA remains in the top-left chrome

Reading view SHALL keep a back button as the leftmost element of the top chrome on all viewports. It SHALL NOT move to the bottom bar.

#### Scenario: Back button in top chrome

- **WHEN** the user is in reading view on any viewport
- **THEN** a back button is displayed at the top-left of the reading chrome

#### Scenario: Back returns to the river

- **WHEN** the user activates the back button
- **THEN** the app returns to the river view, same as today

### Requirement: Help CTA is desktop-only

The keyboard-shortcuts help button in reading view SHALL be visible only on desktop viewports and SHALL NOT be displayed on mobile (≤768px) or on touch devices with coarse pointers at mobile widths.

#### Scenario: Help visible on desktop

- **WHEN** the user is in reading view on a viewport >768px
- **THEN** the help button is visible and opens the shortcuts overlay

#### Scenario: Help hidden on mobile

- **WHEN** the user is in reading view on a viewport ≤768px
- **THEN** the help button SHALL NOT be displayed, regardless of pointer type

#### Scenario: Help remains accessible via keyboard on desktop

- **WHEN** the user presses `?` in reading view on desktop
- **THEN** the shortcuts overlay opens as before

### Requirement: Mobile swipe navigation between articles

On touch devices, a horizontal swipe in the reading view SHALL navigate between articles: swipe left → next article, swipe right → prev article. The gesture SHALL NOT engage from vertical scrolling (dead zone before any visual shift, axis lock that bails when vertical motion dominates), SHALL NOT capture gestures starting in the screen-edge zones reserved for the browser's native back/forward swipe, SHALL NOT capture touches that begin on interactive or horizontally scrollable elements, and SHALL require the swipe to cross a commit threshold — otherwise the view snaps back without navigating.

#### Scenario: Swipe left opens the next article

- **WHEN** the user swipes left in the reading view past the commit threshold on a touch device
- **THEN** the reading view navigates to the next article

#### Scenario: Swipe right opens the previous article

- **WHEN** the user swipes right in the reading view past the commit threshold on a touch device
- **THEN** the reading view navigates to the previous article

#### Scenario: Sub-threshold swipe snaps back

- **WHEN** the user swipes horizontally in the reading view but releases before the commit threshold
- **THEN** the view snaps back to its resting position and no navigation occurs

#### Scenario: Vertical scroll does not trigger navigation

- **WHEN** the user scrolls the article vertically on a touch device
- **THEN** the gesture bails out before any horizontal displacement and no navigation occurs

#### Scenario: Edge-zone swipes are left to the browser

- **WHEN** a horizontal swipe starts within the screen-edge zones reserved for the browser's native back/forward gesture (left and right ~20-24px)
- **THEN** the reading view SHALL NOT capture the gesture
- **AND** the browser's native back/forward swipe behavior is unaffected

#### Scenario: Interactive elements are exempt

- **WHEN** the touch begins on a link, button, iframe, video, or a horizontally scrollable element (`pre`, overflow-x block)
- **THEN** the swipe gesture SHALL NOT be captured, and the element behaves natively

#### Scenario: Swipe does not navigate at boundaries

- **WHEN** the user is at the first item and swipes right, or at the last item and swipes left
- **THEN** no navigation occurs and the view snaps back

#### Scenario: Single item disables swipe

- **WHEN** the filtered results contain only one article
- **THEN** no swipe navigation is active