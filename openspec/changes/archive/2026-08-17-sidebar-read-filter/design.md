## Context

The river currently shows only unread items. Once an item is marked read (via scroll-past, open, swipe, or manual toggle), it disappears from the list. There is no way to browse previously-read items without using the command palette search. The sidebar has a single "All" entry that shows all feeds in unread-only mode.

The existing visual distinction between read and unread items (CSS classes `.river-item.unread` and `.river-item.read`) is already in place — read items have dimmed titles and no accent dot. This means the UI can toggle between both modes without any CSS changes.

## Goals / Non-Goals

**Goals:**
- Add "Unread" and "All" as distinct sidebar entries controlling read filtering
- Feed entries in the sidebar respect the current read filter (sticky — clicking a feed does not reset it)
- The last selected sidebar entry (Unread / All / specific feed) is persisted and restored on next boot
- Default for new users: "Unread" (preserving current behavior as the default)
- Raise the item fetch limit from 200 to 500
- Empty state ("You're all caught up") appears only in "Unread" mode

**Non-Goals:**
- Per-feed read filter toggling (feed entries always inherit the global read filter)
- Virtual scrolling or infinite scroll (500 items is manageable with SolidJS's fine-grained rendering)
- Changes to the implicit mark-read behavior itself (open marks read, scroll-past marks read — same as now)
- New CSS or visual design (existing read/unread styling is already in place)

## Decisions

### D1: Sidebar entries as the view selector

The sidebar gains two virtual entries at the top, before feed entries:

```
▸ Unread    (12)    ← all feeds, unread-only
▸ All               ← all feeds, all items
───
▸ Feed A    (3)     ← respects current read filter
▸ Feed B    (5)
```

"Unread" shows a total unread count badge (same as current "All" entry). "All" does not show a count — it represents "everything".

The active entry gets the accent left-border (same styling as feed active state).

**Alternatives considered:**
- *Top bar segmented control* — more discoverable but adds chrome, violating the progressive disclosure principle (D14 in core design)
- *Settings toggle* — buried, requires deep navigation to change a frequently-used mode
- *Command palette action* — power-user friendly but undiscoverable and awkward for repeated toggling

### D2: State model

`AppState` gains a field; `riverScope` stays unchanged:

```
AppState:
  riverScope: string | null       ← feed filter (null = all)
  readFilter: 'unread' | 'all'    ← NEW
```

Combined behavior:

| readFilter | riverScope | What the river shows |
|---|---|---|
| `'unread'` | `null` | Unread items across all feeds (current default) |
| `'all'` | `null` | All items across all feeds |
| `'unread'` | `feedUrl` | Unread items from that feed (current per-feed) |
| `'all'` | `feedUrl` | All items from that feed |

Sidebar click handler:

```
"Unread"  → setState({ riverScope: null, readFilter: 'unread' })
"All"     → setState({ riverScope: null, readFilter: 'all' })
"Feed A"  → setState({ riverScope: feedUrl })  ← readFilter unchanged
```

### D3: Persistence

`AppSettings` gains two fields:

```
AppSettings:
  ...
  lastFeedUrl: string | null       ← last selected feed (null = all feeds)
  readFilter: 'unread' | 'all'     ← last selected read filter
```

Defaults for fresh users: `lastFeedUrl: null`, `readFilter: 'unread'`.

On every sidebar click → `saveSettingsPatch({ lastFeedUrl, readFilter })` persists both values.

On boot → restore `riverScope` from `lastFeedUrl`, restore `readFilter` from stored value.

The existing `meta` store (via `settings.ts`) handles persistence — no new storage mechanism needed.

**Alternatives considered:**
- *Session-only (no persistence)* — users would lose their mode on every page reload. Frustrating for users who prefer "All" mode.
- *Separate meta key* — unnecessary indirection when AppSettings already covers user preferences.

### D4: DB changes

Add a new function `listItems(limit = 500, opts?: { unreadOnly?: boolean })` that returns items from all feeds in reverse-chronological order:

- When `unreadOnly: true` → same behavior as current `listUnreadAcrossFeeds`: scan items, collect those where `!item.read`, stop at limit
- When `unreadOnly: false` → return items up to limit without filtering by read state (faster — no skip logic)

`listUnreadAcrossFeeds` can remain as a thin wrapper or be replaced entirely — callers switch to `listItems` with the appropriate option.

The existing `listItemsByFeed(feedUrl, { unreadOnly? })` already supports this pattern per-feed and needs no changes.

### D5: Item limit — raise to 500

From 200 to 500 for both modes.

**Rationale:**
- "Unread" mode: 200 is fine (few users have more unread items), but 500 costs nothing extra and handles edge cases
- "All" mode: a moderately busy feed (10 items/day) × 4 feeds = 200 items in 5 days. 500 covers ~2 weeks of history comfortably
- SolidJS's `<For>` component uses fine-grained reactivity — rendering 500 items is fast (no virtual DOM diff)
- The "all" mode query is simpler (no skip logic) so scanning 500 items is fast even over IndexedDB cursors

**Alternatives considered:**
- *Different limits per mode* — adds complexity for negligible gain
- *Unlimited* — unbounded memory usage on mobile, no strong use case for thousands of items in a single view
- *Virtual scrolling* — substantial complexity, not justified for 500 items

### D6: Empty state

- "Unread" mode: "You're all caught up" when `totalUnread === 0` (current behavior, unchanged)
- "All" mode: no "caught up" state. When there are zero items total (fresh install), show the existing empty state — the user needs to add feeds, not catch up
- The `<EmptyState>` component checks the current mode and total item count to decide what to render

### D7: Scroll-past mark-read interaction

In "All" mode, scroll-past marking works the same as in "Unread" mode — items are marked read after the 500ms delay. The difference is that `reloadItems()` returns all items, so the item stays in the DOM and its visual class changes from `.unread` to `.read`.

The IntersectionObserver at `River.tsx:54` already checks `if (!item || item.read) continue;` — once marked read, the observer skips further processing. No observer changes needed.

### D8: Opening and returning from reading view

`closeReading()` calls `reloadItems()` which now respects the current `readFilter` — so returning to the river after reading an item:
- In "Unread" mode: the item is gone (marked read during open)
- In "All" mode: the item stays, now styled as read

## Risks / Trade-offs

### [R1] Performance at 500 items
500 DOM nodes × river-item template is fine on desktop but could be sluggish on low-end mobile devices.
- **Mitigation**: SolidJS's fine-grained reactivity means 500 items render once and only update affected DOM. If perf issues arise, reduce the limit to 300 for mobile or add virtual scrolling later. Not expected to be an issue in practice.

### [R2] User confusion about "Unread" vs "All"
New users might not understand the difference between the two sidebar entries.
- **Mitigation**: Clear visual distinction — active entry gets the accent left-border. "Unread" has a count badge, "All" does not. The labels themselves are self-descriptive and follow RSS reader convention (NetNewsWire, Reeder, Feedly all use this pattern).

### [R3] Persistence restoring a deleted feed
If a user unsubscribes from a feed while "All" was selected with `lastFeedUrl` pointing to that feed, then returns, `riverScope` would reference a feed that no longer exists.
- **Mitigation**: On boot, validate `lastFeedUrl` against the current feed list. If the feed no longer exists, fall back to `riverScope: null` (all feeds) with the stored `readFilter`. This is a rare edge case and the fallback is graceful.

### [R4] Expand interaction with feed-level views in future
If per-feed read filter toggles are added later (e.g., a toggle on feed rows to switch between "All" and "Unread" for that feed), the state model would need to support per-feed overrides of the global `readFilter`.
- **Acceptance**: Not needed now. The current model (sticky global filter + feed scoping) is simple and covers 95% of use cases. The state model can be extended later if needed.

## Migration Plan

1. Add `lastFeedUrl` and `readFilter` to `AppSettings` with safe defaults → no existing data migration needed
2. Add `listItems()` to `db/items.ts` → additive, existing callers unchanged
3. Modify `state.tsx` → `reloadItems()` branches, boot restores state
4. Modify `Sidebar.tsx` → add "Unread" entry, rewire "All" entry, persist on click
5. Modify `River.tsx` → conditional empty state
6. Run `npm run typecheck && npm run lint` to validate

Rollback: revert the 6 modified files.

## Open Questions

None — all design decisions are resolved above.
