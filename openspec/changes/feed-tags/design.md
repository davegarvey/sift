## Context

The sidebar currently shows a flat feed list with hover-reveal `✕` for unsubscribe. The only river filter is feed-scope (single feed or all). Feeds have a `folder?: string[]` field from OPML import that is never rendered.

Users with many feeds have no way to organize or filter by topic. The explore session established a tag-based approach: lightweight labels on feeds, exposed as filter chips in the sidebar.

### Feed type (evolved)

```typescript
interface Feed {
  url: string;
  title: string;
  htmlUrl?: string;
  /** @deprecated No longer written. Kept for backward compat during transition. */
  folder?: string[];
  tags?: string[];               // user-assigned labels, stored normalized
  tagsAt?: number | null;        // epoch ms of last tag edit, for sync conflict resolution
  lastFetched: number | null;
  etag?: string | null;
  lastModified?: string | null;
  learnedIntervalMs: number;
  lastError?: string | null;
  lastItemPublishedAt?: number | null;
  recentPublishCounts?: number[];
}
```

## Goals / Non-Goals

**Goals:**
- Add `tags?: string[]` to the `Feed` type — user-assigned labels
- Render auto-derived tag chips between the "Feeds" heading and "All Feeds" in the sidebar
- Tag chips filter the river (OR semantics for multi-tag), mutually exclusive with feed-scope selection
- Replace hover `✕` with `…` that opens a feed editor modal (tag add/remove with autocomplete, unsubscribe)
- Tag autocomplete across all existing tags in both the add-feed flow and the feed editor
- Sync tags via the existing protocol (same pattern as `folder`)

**Non-Goals:**
- No tag management UI separate from the feed editor
- No item-level tagging
- No tag colors, icons, or categorization
- No folder grouping in the sidebar (folder is deprecated but not removed from the type yet)
- No tag-based sorting in the river
- No drag-and-drop tag assignment

## Decisions

### D1: Tags stored as `string[]` on `Feed`, not a separate store

Tags live directly on the `Feed` record as `tags?: string[]`. No separate tags table or index.

- **Why**: Simple schema evolution (one new field). Tags are always loaded with the feed — no extra queries. The global tag set is derived from `feeds().flatMap(f => f.tags ?? [])`. No orphan management needed.
- **Alternatives**: Separate `FeedTag` store (normalized, but adds queries and sync complexity; no real benefit at this scale).

### D2: Tag autocomplete sourced from all feeds' tags

The tag input in the feed editor and add-feed modal shows a dropdown of existing tags across all feeds (deduplicated). Typing filters the list. New tags are created on-the-fly by typing and pressing Enter/comma.

- **Why**: Emergent tag vocabulary — no separate management step. Tags appear in autocomplete as soon as any feed uses them. Prevents typo proliferation ("Rust", "rust", "RUST").
- **Alternatives**: Hardcoded tag list (requires management UI), no autocomplete (no discovery, more typos).

### D3: Tag normalization — lowercase, trimmed, collapsed whitespace

Tags are normalized on storage: **trim → collapse internal whitespace runs to single space → lowercase**. Comparisons (dedup, autocomplete matching) use the normalized form.

Examples:
| Input | Stored as |
|-------|-----------|
| `Rust` | `rust` |
| `"  Web Dev  "` | `web dev` |
| `web  dev` | `web dev` |
| `DEEP DIVE` | `deep dive` |

- **Why**: Prevents duplicate near-identical tags ("Rust", "rust", "RUST"). Clean storage. Autocomplete matching works naturally since both input and storage are lowercase. Display is still readable ("web dev" is fine).
- **Alternatives**: Case-preserving with case-insensitive comparison (more complex matching logic everywhere — storage, dedup, sync merge).

### D4: Tag filter uses OR semantics, multi-select

Clicking tag chips toggles them. Active state: `activeTags: Set<string>` (used for O(1) membership checks in the filter memo). River shows items from feeds whose tags intersect the active set (OR). Clicking the same tag again deselects it. If all tags deselected, back to all feeds.

- **Why**: OR matches the RSS mental model ("show me my dev OR design feeds"). Multi-select lets the user combine interests without narrowing to zero results.
- **Alternatives**: AND (too restrictive for a reader), single-select (less useful).

### D4: Tags and feed-scope are mutually exclusive

When a tag (or tags) is active, `riverScope` is null. When a feed is clicked, `activeTags` clears. "All Feeds" clears both.

- **Why**: Simple state model — only one active filter at a time. No ambiguous "feed X tagged Y" interaction. The user knows exactly what's controlling the river.
- **Alternatives**: Compound state (feed + tag) — more powerful but harder to communicate in the UI.

### D5: Feed edit modal replaces hover-reveal `✕`

The feed row shows a `…` button (same hover-reveal pattern as the current `✕`). Clicking opens a modal with:
- Feed title as heading
- Tag chips (removable via `✕`) + add-tag input with autocomplete
- Divider
- `[Unsubscribe]` (red, destructive)
- `[Done]` button to close

Tag changes auto-save on each add/remove (like the settings drawer toggles). `[Done]` simply closes the modal — no discard semantics since changes are already persisted.

- **Why**: Auto-save matches the existing settings UX pattern. No save/discard ambiguity. The modal is primarily for viewing and editing tags; `[Done]` is simply a way to close it.
- **Alternatives**: Batch-save on Done with Cancel to rollback (requires dirty state tracker — over-engineering for tag management).

### D6: Tags sync as part of the feed-upsert dirty entry

The existing `DirtyEntry.feed-upsert` gains `tags: string[] | null` and `tagsAt: number`, following the same pattern as `folder`/`folderAt`. The server stores tags as a JSON string (same as folder). Merge uses `newer()` with `tags_at` vs the local `feed.tagsAt` — not `lastFetched`, since tags can be edited independently of feed fetches and using `lastFetched` would let a refresh overwrite a tag edit.

- **Why**: Reuses the existing sync infrastructure — no new dirty entry types, no new server endpoints. A dedicated `tagsAt` field ensures tag edits are never collided with fetch timestamps.
- **Tradeoff**: Last-writer-wins on the full array. If device A adds "rust" and device B adds "design" concurrently, one is silently lost. Acceptable for v1 — low probability of simultaneous tag edits, and the OR filter is forgiving (missed tags mean slightly narrower river, not lost data).
- **Alternatives**: Separate `tag-upsert` entry type (more code, more queue entries), per-tag merge (more complex, no real benefit at this scale).

### D7: Tag chips placed between "Feeds" heading and "All Feeds" entry

```
FEEDS
 [dev] [rust] [design]
 All Feeds
 Feed A  [...]
 Feed B  [...]
```

- **Why**: Natural location — below the section heading, above the feed list. No additional section chrome. Tags are a filter on the feed list/river, so they sit at the boundary between heading and content. If no tags exist, the chip row doesn't render.
- **Alternatives**: Own section with "Tags" heading (too much chrome), above the "Feeds" heading (too far from what they filter), in the river (splits navigation).

### D8: Tag chip styling — subtle, surface background

Tags use `font-size: 12px`, `padding: 2px 8px`, `border-radius: 4px`, `background: var(--surface)`. Active/deselected variants use `var(--accent-dim)` / `var(--accent)`. The row uses `flex-wrap: wrap` and `gap: 4px` with `padding: 4px 16px 0` (reduced bottom padding to sit tight against "All Feeds").

- **Why**: Small enough to not compete with feed rows but large enough to be tappable. Uses existing surface colors — no new palette tokens. Wrapping ensures any number of tags fits.
- **Alternatives**: Full-height feed-style rows (too much space), smaller text (hard to tap on mobile).

### D9: Mobile support — touch targets, modal behavior

Tag chips follow platform best practices for touch targets: minimum 36px height and adequate width padding on touch devices (`@media (any-pointer: coarse)`). Desktop remains at 28px. The sidebar already handles mobile (drawer overlay). The feed editor modal renders as a centered overlay — works on all viewports.

The existing sidebar buttons (feed rows, action buttons) are measured first to determine the baseline touch target size; tag chips match or exceed that baseline.

- **Why**: 28px is below the recommended 44pt touch target on mobile. Following the existing sidebar's touch sizing ensures consistency. The `any-pointer: coarse` media query targets touch-only without affecting mouse/trackpad users.
- **Alternatives**: Uniform 36px on all viewports (wastes vertical space on desktop), 44px everywhere (too large — makes the sidebar feel bloated).

### D10: No entrance animation for tag chips

Tag chips appear without animation. The state change (sidebar re-render) is the visual cue.

- **Why**: Deferred from v1. The complexity of tracking "first appearance" per tag across renders isn't justified for a cosmetic effect. Chips appear instantly on state change — already a clear visual update.
- **Alternatives**: Entrance animation (nice but unnecessary complexity for v1).

## Risks / Trade-offs

- **[R1] Large number of tags**: A user with 50+ unique tags could have a long wrapping row. Mitigation: tags are auto-derived — the UI only shows tags that have at least one feed. If it becomes unwieldy, we can cap visible chips with a "more" overflow, but that's a future concern.
- **[R2] Tag rename not supported**: If a user typos a tag, they can't rename it — they'd need to remove it from all feeds and re-add. Mitigation: the autocomplete nudges toward consistent spelling. Full rename support can be added later if needed.
- **[R3] OR with many tags + many feeds**: Querying items across many tagged feeds with OR could return a large result set. Mitigation: same as current all-feeds query (500 item limit, in-memory filter). Acceptable for v1.
- **[R4] Server-side tag storage**: The sync server currently mirrors the `folder` field. Tags will add a new JSON field to the remote feed record. No server changes if it's a pass-through field.
- **[R5] Feed editor modal complexity**: The modal combines tag management and unsubscribe. Care needed to prevent accidental unsubscribes. Mitigation: unsubscribe is a two-step (click red button → confirm dialog) within the modal, same as current pattern.

## Migration Plan

1. Add `tags?: string[]` and `tagsAt?: number | null` to `Feed` type; deprecate `folder` in comments
2. Bump `DB_VERSION` from 3 to 4 with a no-op upgrade handler
3. Add tag normalization helper (trim → collapse → lowercase)
4. Update `subscribeFeed` / `upsertFeed` to handle `tags` and `tagsAt`
5. Update sync layer — `queue.ts`, `apply.ts`, `merge.ts`, `push.ts`
6. Add tag chips to sidebar (`Sidebar.tsx`) with touch-target CSS
7. Add tag filter state (`activeTags: Set<string>`) and river wiring (`state.tsx`, `River.tsx`)
8. Replace `✕` with `…` on feed rows; create feed editor modal
9. Add tag autocomplete helper (derived from `feeds()` signal)
10. Add tag input to `AddFeedModal`
11. Add CSS for tag chips, feed editor, `…` button, touch targets
12. Add unit tests for tag filter logic and tag normalization
13. `npm run typecheck && npm run lint` — zero errors
14. Manual verification: add tags, filter, sync, mobile
15. Remove deprecated `folder` write path (optional — can defer cleanup)

## Open Questions

None resolved — all design decisions above are committed.
