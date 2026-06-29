## Context

The app currently treats feed items like email: unread counts in the sidebar, a filter toggle to hide read items, and an accent-colored dot on every unread item. This is the traditional RSS reader convention but it creates anxiety (unread backlog) and noise (persistent dot, count badges) that don't match how users actually consume feeds. Feeds are streams, not inboxes — read state is useful as a personal reference but doesn't need numeric prominence.

The existing implementation has:
- Sidebar unread badges (total + per-feed) computed by filtering items in memory
- Filter toggle (Unread/All) that controls which items the river renders
- A 24px indicator column in the river grid with a dot (unread) or checkmark (hover)
- Read/unread title weight distinction (600 vs 400) already in place
- Implicit mark-read on scroll-past (IntersectionObserver with 500ms debounce)
- Swipe gestures (right = read, left = star)

## Goals / Non-Goals

**Goals:**
- Remove all numeric unread counts from the UI
- Remove the Unread/All filter toggle
- Remove the accent-colored unread dot indicator
- Read/unread distinguished purely through title weight (600 vs 400) and color
- Add a hover-reveal action toolbar on the right edge of river items (Gmail-style)
- Show star inline after the title when active (no dedicated column)
- River always shows all items (read + unread)
- Empty state is a single message ("No items yet.")
- Clean up unused code paths (unreadOnly param, readFilter state)
- Remove empty grid columns in the river item layout

**Non-Goals:**
- No changes to the implicit mark-read-on-scroll behavior
- No changes to swipe gestures (they remain as-is)
- No changes to the reading view or its star toggle
- No new action types beyond read-toggle and star in the hover toolbar
- No bulk operations per feed
- No "new since last session" concept

## Decisions

### D1: River shows all items, no filter

**Choice**: Remove the Unread/All filter toggle entirely. The river always renders all items.

**Rationale**: The filter was the mechanism that made unread counts meaningful — you'd look at the count and switch to "Unread" to clear items. Without counts, the filter loses its primary driver. Users can visually scan past dimmed read items. This also simplifies the mental model: the river is everything, sorted by time.

**Rejected**: Keeping the filter but defaulting to "All." This preserves dead UI surface area. The toggle was only useful as a companion to the counts.

### D2: Title weight as the sole read/unread indicator

**Choice**: Remove the accent-colored dot. Unread items get `font-weight: 600` and `color: var(--text)`. Read items get `font-weight: 400` and `color: var(--subtext)`. This was already implemented alongside the dot; the dot was the redundant signal.

**Rationale**: The dot occupied a 24px column that was mostly empty space. The title weight distinction is faster to scan visually (you read left-to-right naturally) and doesn't require any dedicated layout space. It also aligns with the "progressive disclosure" principle — the signal is in the content itself, not in chrome.

**Rejected**: Keeping the dot as a thinner treatment (outline vs filled). Still requires a column. Still adds visual noise.

### D3: Right-edge hover toolbar (Gmail-style)

**Choice**: On hover/focus, action icons appear at the right edge of the river item. The toolbar is `position: absolute; right: 0; top: 50%; transform: translateY(-50%)` — no layout footprint.

**Rationale**: Gmail's pattern is well-understood and scales to N actions. The right edge doesn't interfere with the left-to-right reading flow. The toolbar fades in (opacity 0→1) so it doesn't cause layout shift.

**Rejected**: Left-anchored toolbar (competed with content), always-visible icons (too noisy), gesture-only (not discoverable on desktop).

### D4: Inline star after title

**Choice**: When an item is starred, a `★` character is appended to the title text via a `<span>` in the JSX. No auto grid column.

**Rationale**: The star is an attribute of the content itself, not a separate chrome element. Inlining it after the title means no dedicated column, no alignment concerns, and it reads naturally: "Title ★". The star icon in the hover toolbar provides the toggle affordance.

**Rejected**: Dedicated column (wasted space), left-side indicator (competed with read signal).

### D5: Remove unreadOnly from data layer

**Choice**: Delete the `unreadOnly` parameter from `listItems()` and `listItemsByFeed()`. The callers no longer need it.

**Rationale**: Dead code. The UI never filters by unread state at query time anymore. If the flag is needed in the future, it can be re-added. Keeping it is a maintenance hazard (unused parameter).

**Rejected**: Keeping it with a deprecation comment. Unnecessary complexity for v0.

### D6: readFilter stays in persisted settings schema, removed from AppState

**Choice**: `readFilter` remains in the `AppSettings` type in `db/types.ts` so that previously-saved settings don't break on upgrade. But it is removed from `AppState` (runtime state) and never read by any component. The `reloadItems` function no longer passes `unreadOnly`.

**Rationale**: Backward compat for existing persisted settings. Since there are no users yet (v0), this is defensive only — the field becomes a no-op in the settings object until a future cleanup pass removes it entirely.

## Risks / Trade-offs

**[Risk] Users rely on the unread filter to manage high-volume feeds** → The river now shows all items. Read items are dimmed but present. Users must scroll past them to reach new items. Mitigation: read items appear below the fold naturally (reverse-chronological), so the newest items are always at the top. The dimmed styling makes them easy to visually skip.

**[Risk] Removing counts removes the "at a glance" awareness of backlog** → This is intentional. The change assumes feeds are streams, not inboxes. Users who want backlog awareness can still infer it visually from the proportion of bold vs dimmed items in the river.

**[Risk] Hover toolbar is not accessible on mobile** → Swipe gestures remain as the primary mobile interactions (swipe right = toggle read, swipe left = toggle star). The hover toolbar is desktop-only. This matches existing patterns.

**[Risk] Star is harder to discover inline** → The star toggle is available in three ways: hover toolbar (desktop), swipe left (mobile), and reading view. Inline display after the title is a read-only indicator, not the primary toggle affordance.

## Open Questions

- Should the hover toolbar appear on focus (keyboard navigation) as well as hover? Current progressive disclosure spec says focus reveals contextual affordances — this should apply.
