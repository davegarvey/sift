## Why

Tags can't be added in the Feed Editor modal — typing a tag name and pressing Enter calls `addTag()` which fires `onChange`, but the `value` prop is derived from `feed()?.tags` which only updates when `reloadFeeds()` runs. Since `ctx.updateFeedTags()` persists to IndexedDB without calling `reloadFeeds()`, the TagInput never re-renders with the new tag. The fix also addresses secondary issues surfaced by red-teaming: stale state on modal re-open, no debounce on tag saves, and dead code.

## What Changes

- **FeedEditorModal**: Introduce a `localTags` signal initialized from `feed()?.tags` and pass it as `value` to `TagInput`, mirroring the existing `localTitle`/`localUrl` pattern. On change, update the local signal immediately (for responsive UI) and persist via `ctx.updateFeedTags()`, then call `reloadFeeds()` to keep the in-memory feed map and `allTags` suggestions in sync.
- **Tag save debounce**: Wrap the tag persistence call in a debounce (matching `scheduleTitleSave`'s 500ms pattern) to avoid redundant IndexedDB writes and sync queue spam during rapid tag add/remove.
- **Dead code removal**: Remove unused `updateFeedTags` import and unused `feedTitle` function from `FeedEditorModal.tsx`.
- **TagInput auto-focus**: Remove or conditionalize the `onMount` `requestAnimationFrame` focus on the tag input field so it doesn't steal focus from the title field on mount.

## Capabilities

### New Capabilities
- `feed-editor-tags`: Tag add/remove in the Feed Editor modal with immediate UI feedback, debounced persistence, and correct state restoration on modal re-open.

### Modified Capabilities
*(none)*

## Impact

- `src/components/FeedEditorModal.tsx` — local tag state, debounced save, dead code removal
- `src/components/TagInput.tsx` — remove unconditional auto-focus on mount
