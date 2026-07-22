## Context

The Feed Editor modal lets users edit a feed's name, URL, and tags. Name uses a local signal + debounced auto-save (500ms). URL saves on blur with validation. Tags use `TagInput` with `value={feed()?.tags ?? []}` — a derived signal from `ctx.feedMap()` — and save via `ctx.updateFeedTags()` which writes to IndexedDB without calling `reloadFeeds()`. Since `feedMap()` never updates, the TagInput never re-renders.

The `AddFeedModal` works correctly because it uses a local `tags()` signal. The fix adopts the same pattern for `FeedEditorModal`.

## Goals / Non-Goals

**Goals:**
- Pressing Enter in the tag input immediately shows the new tag chip
- Tags persist to IndexedDB and sync queue
- Tags survive modal close/re-open (via `reloadFeeds()`)
- `allTags` suggestions include newly added tags within the same session
- Tag save is debounced to avoid redundant writes during rapid edits
- Remove dead code (`updateFeedTags` import, `feedTitle` function)
- TagInput no longer steals focus on mount

**Non-Goals:**
- Not changing the `AddFeedModal` tag behavior (already correct)
- Not changing the sync layer or tag data model
- Not introducing a general "unsaved changes" guard
- Not addressing the `normalizeTag("all")` silent rejection (separate issue)

## Decisions

1. **Local signal + reloadFeeds (not just local signal)**
   - Alternative: Local signal only → tags visible during session but lost on re-open until a background refresh hits.
   - Alternative: No local signal, just reloadFeeds → tag chips appear only after the async DB write + reload cycle (perceptible lag).
   - Chosen: Local signal for immediate UI, then async save + reloadFeeds for persistence and cross-session correctness. Matches the UX expectation set by `AddFeedModal`.

2. **Debounce on tag save (500ms, like title)**
   - Alternative: No debounce → each tag add/remove triggers sequential `getFeed` + `updateFeed` + `enqueueFeed` + `scheduleFlush`. Fine for 3-5 tags but wasteful for bulk edits.
   - Chosen: 500ms debounce matching `scheduleTitleSave`. UI updates immediately via `localTags`; persistence is coalesced.

3. **Remove TagInput auto-focus**
   - Alternative: Keep it → steals focus from the title input which is the natural first edit target.
   - Chosen: Remove the `onMount` `requestAnimationFrame` focus. The modal itself has no auto-focus on any field; user clicks the field they want to edit.

4. **Dead code removal**
   - `updateFeedTags` import on line 3 of `FeedEditorModal.tsx` is unused (only `ctx.updateFeedTags` is called).
   - `feedTitle` function on line 78 is unused.
   - Chosen: Remove both for cleanliness.

## Risks / Trade-offs

- [Debounce timing] A 500ms debounce means if the user closes the modal <500ms after the last tag edit, the write could be lost → Mitigation: The `onCleanup` already flushes the title debounce timer; extend it to also flush the tag debounce timer on cleanup.
- [reloadFeeds cost] `reloadFeeds()` re-reads ALL feeds from IndexedDB. For a single tag edit this is overfetching → Acceptable: feeds list is typically small (<500), IndexedDB reads are fast, and the correctness benefit of consistent state is worth the minor cost.
- [Race with sync] If a sync push arrives concurrently with a tag save, the reloadFeeds after save could momentarily show stale data → Acceptable: the next sync pull will reconcile.
