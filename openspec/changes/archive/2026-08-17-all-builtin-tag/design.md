## Context

The sidebar uses two mutually exclusive mechanisms for view scoping: `riverScope` (feed URL or null for "All Feeds") and `activeTags` (OR-semantics tag filtering). "All Feeds" is a dedicated row below the tag chips that clears tags and sets `riverScope` to `null`. This dual-model adds visual clutter and a conceptual seam — a built-in `all` tag can unify everything under a single tag-based navigation model.

No data model changes are needed. Tags are stored as `string[]` on `Feed` objects. The `all` builtin is purely a UI construct: selecting it maps to the same state as "All Feeds" today (`riverScope === null && activeTags.length === 0`).

## Goals / Non-Goals

**Goals:**
- Replace the "All Feeds" sidebar row with a built-in `all` tag chip, always present as the first item in the tag chips row
- Always show the tag chips area in the sidebar (currently hidden when `allTags().length === 0`)
- Prevent users from creating or assigning a tag named `all`
- No functional change: selecting `all` shows all items, identical to current "All Feeds" behaviour
- Remove the `all-feeds` CSS class and the `selectAllFeeds` handler

**Non-Goals:**
- No changes to the feed-per-view (`riverScope`) model — individual feed selection still works as today
- No data model or DB schema changes
- No changes to the sync protocol (tags are per-feed; `all` is never persisted)
- No URL routing changes

## Decisions

1. **Pure UI construct, no persistence** — `all` is never stored on any `Feed.tags` array. It's injected into the tag chips list at render time. This keeps the builtin invisible to sync, export, and DB operations.

2. **Tag name reservation in `normalizeTag`** — The `normalizeTag` utility will be taught to reject the reserved name `all`. An alternative was to add custom validation in each consumer (`TagInput`, `AddFeedModal`, `FeedEditorModal`), but centralising it ensures the guard can't be bypassed by a new consumer. New signature: `normalizeTag(input: string): string | null` (returns `null` for reserved names).

3. **`all` is always the first chip** — It appears before any user-defined tags. This mirrors the visual position of "All Feeds" at the top of the feed list and gives a consistent "home" affordance.

4. **Sidebar tag chips area always visible** — The `<Show when={ctx.allTags().length > 0}>` guard changes to just always render the `.tag-chips` div with at least the `all` chip.

5. **Active state** — The `all` chip is active when `riverScope === null && activeTags.length === 0`. Clicking `all` clears tags and sets `riverScope` to `null` (same logic as the removed `selectAllFeeds`). Clicking any other tag deselects `all` (clears `riverScope`), which is existing behaviour.

6. **No removal of `riverScope`** — Individual feed views still work via `riverScope`. The `all` chip only replaces the `riverScope === null` case.

## Risks / Trade-offs

- **Reserved name collision** → If a user already has a tag named `all`, `normalizeTag` will begin rejecting it. Mitigation: grep all feeds for the tag `all` on boot and surface a console warning; the existing tag will still work as a normal tag until the user edits it.
- **Tag chips area padding when empty** → With always-visible tag chips and only the `all` chip, the row may look bare. Mitigation: negligible — a single chip plus padding is visually fine and provides the always-present home button.
- **User confusion about "all" as a tag vs "all" feeds** → Risk is low since the chip replaces the row in the same visual area with identical behaviour.
