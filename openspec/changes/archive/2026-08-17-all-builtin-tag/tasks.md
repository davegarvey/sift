## 1. Reserve `all` in normalizeTag

- [x] 1.1 Change `normalizeTag` return type to `string | null` and return `null` when the normalized result is `"all"`
- [x] 1.2 Update `normalizeTag` callers to handle `null` returns

## 2. Update Sidebar component

- [x] 2.1 Remove the `selectAllFeeds` handler function
- [x] 2.2 Remove the "All Feeds" row (`<div class="feed all-feeds">`)
- [x] 2.3 Remove the `<Show when={ctx.allTags().length > 0}>` wrapper so tag chips area is always visible
- [x] 2.4 Inject `all` as the first chip before user-defined tags in the `For` loop
- [x] 2.5 Add a new `selectAll` handler — clears tags, sets `riverScope` to `null`, saves `lastFeedUrl: null`, reloads
- [x] 2.6 The `all` chip shows active when `riverScope === null && activeTags.length === 0`

## 3. Guard tag input against `all`

- [x] 3.1 In `TagInput.addTag`, after `normalizeTag` returns `null` for a reserved name, silently reject (no-op, clear input)
- [x] 3.2 In `TagInput.suggestions`, filter out any suggestion that normalizes to `"all"` from the autocomplete list

## 4. Clean up dead code

- [x] 4.1 Remove the `all-feeds` className reference from JSX
- [x] 4.2 Verify `allTags()` derived signal in state.tsx still only returns feed-level tags (confirmed — no change needed)

## 5. Update tests

- [x] 5.1 Update `tests/tags.test.ts` — add test cases for `normalizeTag` returning `null` for `"all"` and its case/whitespace variants
- [x] 5.2 Update `tests/tag-filter.test.ts` — existing "returns all feeds when no tags active" test already covers the `all` concept
- [x] 5.3 Run `npm test` — 81 tests pass, all green
