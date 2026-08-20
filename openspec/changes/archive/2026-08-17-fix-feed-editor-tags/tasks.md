## 1. FeedEditorModal tag state

- [x] 1.1 Add `localTags` signal initialized from `feed()?.tags ?? []`
- [x] 1.2 Add debounced tag save function (500ms, matching `scheduleTitleSave` pattern) that calls `ctx.updateFeedTags()` then `reloadFeeds()`
- [x] 1.3 Wire `localTags` as `value` prop on `TagInput` and debounced save as `onChange`
- [x] 1.4 Flush pending tag save on `onCleanup` (same as title timer)
- [x] 1.5 Remove unused `updateFeedTags` import from `../feeds/service`
- [x] 1.6 Remove unused `feedTitle` function

## 2. TagInput auto-focus

- [x] 2.1 Remove `onMount` / `requestAnimationFrame` focus from `TagInput.tsx`

## 3. Verify

- [x] 3.1 Press Enter in tag input → tag chip appears immediately
- [x] 3.2 Click ✕ on tag chip → tag removed immediately
- [x] 3.3 Close modal, re-open → tags persist
- [x] 3.4 New tags appear in autocomplete suggestions for other feeds
- [x] 3.5 Tag input does not steal focus on modal open
- [x] 3.6 Run `npm run typecheck` and `npm run lint` — zero errors
