## MODIFIED Requirements

### Requirement: Default view is a reverse-chronological river of all items
The app SHALL open directly into a river view listing all items (read and unread) across all subscribed feeds in reverse-chronological order. The river is the default and must not be hidden behind navigation.

#### Scenario: App opens with items available
- **WHEN** the app boots and IndexedDB contains items
- **THEN** the river is rendered immediately with the most recent item at the top
- **AND** read items are visually distinguished from unread items through title weight (600 bold for unread, 400 normal for read)

#### Scenario: App opens with no items and no feeds
- **WHEN** the app boots and no feeds are subscribed
- **THEN** an empty state is rendered with the message "Welcome to Sift" and an "Add your first feed" affordance

#### Scenario: App opens with feeds but no items
- **WHEN** the app boots, feeds exist, but IndexedDB contains no items (pre-refresh or after data clear)
- **THEN** an empty state is rendered with the message "No items yet." and a "Check for new items" affordance

#### Scenario: User navigates back to the river from reading view
- **WHEN** the user presses `Esc`, the back gesture, or the browser back button while in reading view
- **THEN** the river is shown at the same scroll position the user left

### Requirement: Read/unread distinguished by title weight, not a dot
Read state SHALL be signaled exclusively through typography. Unread items SHALL use a bold title (`font-weight: 600`) and full text color. Read items SHALL use normal weight (`font-weight: 400`) and a dimmer text color. No accent-colored indicator, dot, or icon SHALL be used to signal read state. The accent color SHALL remain reserved for active selection/hover backgrounds only.

#### Scenario: An unread item is rendered
- **WHEN** an item in the river is unread
- **THEN** its title is rendered at `font-weight: 600` with `color: var(--text)`

#### Scenario: A read item is rendered
- **WHEN** an item in the river is read
- **THEN** its title is rendered at `font-weight: 400` with `color: var(--subtext)`

#### Scenario: An item is focused
- **WHEN** an item in the river is keyboard-focused or hovered
- **THEN** the selection background uses the accent color

### Requirement: Hover toolbar with contextual actions
River items SHALL reveal a toolbar of action icons on hover (desktop) or focus (keyboard). The toolbar SHALL appear at the right edge of the item with no layout shift. Actions SHALL include a mark-read/unread toggle and a star toggle. The toolbar SHALL follow progressive disclosure — invisible by default, revealed on intent.

#### Scenario: User hovers a river item
- **WHEN** a desktop user hovers a river item
- **THEN** a toolbar with action icons fades in at the right edge of that item

#### Scenario: User focuses a river item with keyboard
- **WHEN** a user keyboard-navigates to a river item
- **THEN** the same toolbar is visible for the focused item

#### Scenario: User toggles read state from the toolbar
- **WHEN** the user clicks the read-toggle icon in the toolbar
- **THEN** the item's read state is toggled and the icon reflects the new state

#### Scenario: User toggles star from the toolbar
- **WHEN** the user clicks the star icon in the toolbar
- **THEN** the item's starred state is toggled and the icon reflects the new state

### Requirement: Starred items show inline indicator
When an item is starred, a star character SHALL appear inline after the title text. This is a read-only indicator. The toggle affordance for starring SHALL be available in the hover toolbar (desktop), via swipe-left gesture (mobile), and in reading view. No dedicated grid column SHALL be reserved for the star.

#### Scenario: Starred item appears in the river
- **WHEN** an item in the river has its `starred` property set to `true`
- **THEN** a `★` character is rendered immediately after the title text

#### Scenario: Unstarred item appears in the river
- **WHEN** an item in the river has its `starred` property set to `false`
- **THEN** no star character appears after the title

### Requirement: No card borders or heavy chrome in the river
Items in the river SHALL be separated by whitespace and a single hairline rule. The list SHALL have no card borders, no drop shadows, no gradients, and no per-item background until an item is focused or hovered. No dedicated indicator column SHALL exist — the item layout SHALL be a single-column flow.

#### Scenario: Multiple items render in the river
- **WHEN** three or more items are visible in the river
- **THEN** they are separated by vertical whitespace and a thin horizontal rule
- **AND** no item has a visible border, shadow, gradient, or dedicated indicator column

## REMOVED Requirements

### Requirement: Empty state is shown without hiding the app
**Reason**: Replaced by a simpler empty state handled within the "Default view" requirement. The "You're all caught up." message assumed an unread-only filter that no longer exists. The new default view includes two empty-state scenarios (no feeds, or feeds but no items) that cover the same cases without an additional requirement.

### Requirement: Single accent color reserved for unread and selection only
**Reason**: The accent color is no longer used for unread indication. The "accent-colored unread indicator" scenario is removed. The accent color remains reserved for selection/hover backgrounds only (this is covered by the focused-item scenario in the read/unread requirement above).

### Requirement: Starring is available only in reading view
**Reason**: Starring is now also available via the hover toolbar and inline indicator in the river. The original requirement's body text and scenarios are superseded by the new "Starred items show inline indicator" and "Hover toolbar" requirements.

### Requirement: Progressive disclosure governs all chrome
**Reason**: Replaced by the more specific "Hover toolbar with contextual actions" requirement. The original principle is retained in spirit — the new requirement is more specific about what is revealed and when.
