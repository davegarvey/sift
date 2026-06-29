## ADDED Requirements

### Requirement: App shell is the static bundle served by the server
The application's HTML, JavaScript, CSS, and static assets SHALL be served as a static bundle from `/` and `/assets/*`. The browser is the sole runtime for application logic, state, scheduling, parsing, and rendering.

#### Scenario: User loads the app in a browser
- **WHEN** the user navigates to the application's root URL
- **THEN** the server returns the static HTML shell and the browser boots the application

#### Scenario: Offline load after first visit
- **WHEN** the user revisits the app with no network connection and has loaded it at least once before
- **THEN** the service worker serves the cached app shell and the app boots from IndexedDB
- **AND** any feed refresh attempt fails gracefully without blocking the UI

### Requirement: Default view is a reverse-chronological river of unread items
The app SHALL open directly into a river view listing unread items across all subscribed feeds in reverse-chronological order. The river is the default and must not be hidden behind navigation.

#### Scenario: App opens with unread items available
- **WHEN** the app boots and IndexedDB contains unread items
- **THEN** the river is rendered immediately with the most recent item at the top

#### Scenario: App opens with no unread items
- **WHEN** the app boots and IndexedDB contains no unread items
- **THEN** an empty state is rendered with the message "You're all caught up." and a subtle "Check for new items" affordance

#### Scenario: User navigates back to the river from reading view
- **WHEN** the user presses `Esc`, the back gesture, or the browser back button while in reading view
- **THEN** the river is shown at the same scroll position the user left

### Requirement: Sidebar is on demand, not always-visible chrome
Feeds, folders, and subscriptions SHALL live in a collapsible sidebar that does not appear by default on mobile and is toggleable on desktop. The sidebar must never block the river on small viewports.

#### Scenario: Desktop user toggles the sidebar
- **WHEN** a desktop user presses `Cmd+\`
- **THEN** the sidebar is shown or hidden without losing river scroll state

#### Scenario: Mobile user opens the sidebar
- **WHEN** a mobile user taps the menu affordance or performs an edge-swipe from the left edge
- **THEN** the sidebar is revealed as a drawer overlaying the river

#### Scenario: Mobile user dismisses the sidebar
- **WHEN** the sidebar drawer is open and the user taps outside it or performs the back gesture
- **THEN** the drawer closes and the river is visible

### Requirement: Reading view replaces the river, not a side-by-side pane
Opening an item SHALL replace the river view with a full-focus reading view. The sidebar SHALL be hidden in reading view. Returning from reading view SHALL restore the river and its scroll position.

#### Scenario: User opens an item from the river
- **WHEN** the user taps, clicks, or presses `Enter` on an item in the river
- **THEN** the reading view takes over the full viewport and the sidebar is hidden

#### Scenario: User returns from reading view
- **WHEN** the user presses `Esc` or the back gesture while in reading view
- **THEN** the river is restored at the scroll position from which the item was opened

### Requirement: Keyboard-first navigation on desktop
The app SHALL support keyboard shortcuts as the primary navigation on devices with physical keyboards. Shortcuts must never be the only way to take an action (a visible alternative exists or the action is contextual).

#### Scenario: User navigates the river with j/k
- **WHEN** a desktop user presses `j` or `k` while in the river view
- **THEN** the next or previous item is focused and scrolled into view

#### Scenario: User opens an item with the keyboard
- **WHEN** a desktop user presses `Enter` while an item is focused in the river
- **THEN** the item is opened into reading view

#### Scenario: User opens the shortcuts overlay
- **WHEN** a desktop user presses `?`
- **THEN** a modal overlay lists every available shortcut
- **AND** the overlay dismisses on the next key press or `Esc`

#### Scenario: User invokes search
- **WHEN** a desktop user presses `/` or `Cmd+K`
- **THEN** a command palette opens with a focused search input

### Requirement: Touch gestures on mobile
The app SHALL support swipe and pull gestures as primary mobile interactions. Gestures must be discoverable through visible behavior on first use but never require on-screen labeling.

#### Scenario: User swipes right on a list item
- **WHEN** a mobile user swipes right on an item in the river
- **THEN** the item is marked read and the unread indicator animates away

#### Scenario: User swipes left on a list item
- **WHEN** a mobile user swipes left on an item in the river
- **THEN** the item's starred state is toggled and a star icon briefly animates

#### Scenario: User pulls down at the top of the river
- **WHEN** a mobile user pulls down from the top of the river beyond a threshold
- **THEN** all feeds are refreshed

### Requirement: Two themes, following system preference
The app SHALL provide light and dark themes only. The default theme follows the user's operating-system preference via `prefers-color-scheme`. No per-feed theming, accent pickers, or third themes are exposed.

#### Scenario: App boots with system in dark mode
- **WHEN** the app boots and `prefers-color-scheme` evaluates to `dark`
- **THEN** the dark theme is applied to all surfaces

#### Scenario: User changes system theme while app is open
- **WHEN** the operating system theme changes while the app is open
- **THEN** the app updates its theme to match without requiring a reload

### Requirement: Single accent color reserved for unread and selection only
One accent color SHALL be used exclusively for the unread indicator and the active selection background. All other surfaces and text use grayscale values. No gradients, no per-feed colors.

#### Scenario: An unread item is rendered
- **WHEN** an item in the river is unread
- **THEN** an accent-colored unread indicator is displayed beside the item

#### Scenario: An item is focused
- **WHEN** an item in the river is keyboard-focused or hovered
- **THEN** the selection background uses the accent color and the item's unread indicator is unchanged

### Requirement: Typography uses sans for chrome and serif for article bodies
UI chrome SHALL use a sans-serif stack (Inter or system). Reading view article bodies SHALL use a serif stack (Charter, Iowan Old Style, Georgia, serif). Article body width SHALL be constrained to a comfortable reading measure (approximately 65 characters).

#### Scenario: An item is rendered in the river
- **WHEN** the river displays an item preview
- **THEN** the title, source label, time, and excerpt are rendered in the sans-serif UI stack

#### Scenario: An article is rendered in reading view
- **WHEN** the reading view shows an extracted article body
- **THEN** the body text uses the serif stack and the column width is constrained to approximately 65 characters

### Requirement: No card borders or heavy chrome in the river
Items in the river SHALL be separated by whitespace and a single hairline rule. The list SHALL have no card borders, no drop shadows, no gradients, and no per-item background until an item is focused or hovered.

#### Scenario: Multiple items render in the river
- **WHEN** three or more items are visible in the river
- **THEN** they are separated by vertical whitespace and a thin horizontal rule
- **AND** no item has a visible border, shadow, or gradient

### Requirement: Implicit mark-as-read on open and on scroll
Opening an item SHALL mark it read immediately. Scrolling an item fully out of the river viewport SHALL mark it read after a short delay. These behaviors are defaults and may be disabled in settings.

#### Scenario: User opens an unread item
- **WHEN** the user opens an unread item into reading view
- **THEN** the item's `read` state is set to true immediately on open

#### Scenario: User scrolls past an item without opening it
- **WHEN** an item scrolls fully out of the visible river viewport
- **AND** the user has not disabled the "mark read on scroll past" setting
- **THEN** the item's `read` state is set to true after a configurable delay (default 500ms)

#### Scenario: User disables mark-read-on-scroll
- **WHEN** the user toggles "Mark items read when I scroll past them" off in settings
- **THEN** scrolling an item out of the river viewport does not change its `read` state

### Requirement: Starring is available only in reading view
The star/unstar action SHALL be available in reading view as a contextual icon. List-level starring uses swipe gestures only (mobile) or a hover-visible toggle (desktop). No bulk star/unstar actions in v0.

#### Scenario: User stars an article in reading view
- **WHEN** the user activates the star affordance in reading view
- **THEN** the item's `starred` state toggles and the affordance reflects the new state

#### Scenario: User stars an item by swiping
- **WHEN** a mobile user swipes left on a river item
- **THEN** the item's `starred` state toggles

### Requirement: Settings and subscriptions management are drawer/modal, not panes
The settings view, subscription management, and import/export flows SHALL appear as drawers or modals over the river, never as persistent panes.

#### Scenario: User opens settings
- **WHEN** the user activates the settings affordance
- **THEN** a settings drawer or modal is shown over the current view

#### Scenario: User closes settings
- **WHEN** the user dismisses the settings drawer
- **THEN** the previous view (river or reading) is restored without state loss

### Requirement: Empty state is shown without hiding the app
When there are no unread items, the river SHALL display an empty state with the message "You're all caught up." and a subtle "Check for new items" link. The app SHALL NOT hide navigation or chrome in the empty state.

#### Scenario: All items are read
- **WHEN** the user's IndexedDB contains no unread items
- **THEN** the river body shows "You're all caught up." and a "Check for new items" link below it

### Requirement: Command palette hosts search and two quick actions
The `Cmd+K` command palette SHALL be the only search affordance and SHALL also host exactly two quick actions in v0: "Add feed..." and "Refresh all". No other quick actions SHALL be present in v0.

#### Scenario: User invokes the command palette
- **WHEN** the user presses `Cmd+K` (or `/` on desktop)
- **THEN** a palette opens with a focused text input
- **AND** the palette shows three categories: search results (items matching the typed query), "Add feed...", and "Refresh all"

#### Scenario: User dismisses the command palette
- **WHEN** the user presses `Esc` while the palette is open
- **THEN** the palette closes and the user returns to the previous view

#### Scenario: User selects "Add feed..." from the palette
- **WHEN** the user invokes "Add feed..." from the palette
- **THEN** the Add Feed flow opens (the same flow as the sidebar's Add Feed affordance)

#### Scenario: User selects "Refresh all" from the palette
- **WHEN** the user invokes "Refresh all" from the palette
- **THEN** all feeds are refreshed immediately regardless of staleness

#### Scenario: User searches items by query
- **WHEN** the user types a query into the palette
- **THEN** the palette shows items whose title or excerpt matches the query, drawn from the IndexedDB store
- **AND** selecting a search result opens the item in reading view

### Requirement: Refresh indicator appears only when feeds are stale
A refresh affordance SHALL appear in the top chrome only when the app detects stale feeds. The affordance SHALL NOT be a permanent button.

#### Scenario: All feeds are fresh
- **WHEN** no feed has `lastFetched + learnedIntervalMs < now`
- **THEN** no refresh affordance is visible in the top chrome

#### Scenario: Some feeds are stale
- **WHEN** at least one feed has `lastFetched + learnedIntervalMs < now`
- **THEN** a refresh affordance is shown in the top chrome

### Requirement: App is responsive across desktop and mobile viewports
The app SHALL deliver the same functional surface on mobile and desktop, adapting layout rather than removing features. The sidebar, reading view, and river must reflow correctly across viewport widths.

#### Scenario: App is used on a mobile-width viewport
- **WHEN** the viewport width is below the mobile breakpoint (768px default)
- **THEN** the sidebar becomes a drawer, the river fills the viewport, and reading view replaces the river full-screen

#### Scenario: App is used on a desktop viewport
- **WHEN** the viewport width is at or above the mobile breakpoint
- **THEN** the sidebar is visible by default, the river occupies the remaining width, and reading view replaces the river full-screen

### Requirement: Add feed is a single input with auto-discovery
Adding a feed SHALL accept any URL and auto-discover the feed. The user must not be required to know what RSS is or to provide a feed URL.

#### Scenario: User pastes a homepage URL
- **WHEN** the user pastes a site's homepage URL into the Add Feed input and submits
- **THEN** the app fetches the page (via the `/article` or `/feed` proxy), parses for `<link rel="alternate" type="application/rss+xml">`, and reports the discovered feed before subscribing

#### Scenario: User pastes a feed URL directly
- **WHEN** the user pastes a URL whose body parses as a valid feed
- **THEN** the app reports the discovered feed's title and recent item count before subscribing

#### Scenario: Discovery finds no feed
- **WHEN** the user pastes a URL where neither the body nor linked alternates parse as a valid feed
- **THEN** an error is shown with options to retry or cancel

### Requirement: Progressive disclosure governs all chrome
The app SHALL apply progressive disclosure as the chrome-design principle: by default, the user sees only what is needed for the current step. Power-user affordances are revealed on intent (hover, focus, keyboard, or explicit toggle), never by default.

#### Scenario: A new user opens the app for the first time
- **WHEN** the app boots into the river with no prior state
- **THEN** only the river, the `⌘K` affordance, and the "Add feed" affordance are visible

#### Scenario: A user hovers an item in the river
- **WHEN** a desktop user hovers or focuses a river item
- **THEN** additional contextual affordances (manual read toggle) become visible for that item only