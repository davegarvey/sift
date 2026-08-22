## 1. Data model

- [x] 1.1 Add `tags?: string[]` and `tagsAt?: number | null` to `Feed` type in `src/db/types.ts`; deprecate `folder` with a `@deprecated` JSDoc comment
- [x] 1.2 Create tag normalization helper: `normalizeTag(input: string): string` — trim, collapse internal whitespace runs to single space, lowercase. Place in `src/util/tags.ts` or inline where first needed.
- [x] 1.3 Bump `DB_VERSION` from 3 to 4 in `src/db/types.ts` with a no-op upgrade handler in `src/db/open.ts`

## 2. Sync layer

- [x] 2.1 Add `tags: string[] | null` and `tagsAt: number` to `DirtyEntry.feed-upsert` in `src/sync/queue.ts`; update `enqueueFeed()` to accept and pass them
- [x] 2.2 Add `tags?: string | null` and `tags_at?: number | null` to `RemoteFeed` in `src/sync/apply.ts`; add merge logic using `newer()` with `tags_at` vs local `feed.tagsAt` (not `lastFetched`)
- [x] 2.3 Update `src/sync/push.ts` `chunkToBody()` to serialize tags in the feed payload (same pattern as folder)
- [x] 2.4 Update `src/sync/merge.ts` `runFirstTimeSetup()` to include `tags` and `tagsAt` in the enqueue loop (rides alongside existing feed enqueue — just add the fields to the call)

## 3. Feed subscription — tag input

- [x] 3.1 Create a derived global tag set: `allTags` memo and `activeTagSet` memo in state from `feeds()` signal
- [x] 3.2 Create a reusable `TagInput` component with autocomplete: text input + dropdown of matching existing tags (normalized match), Enter/comma to create, backspace to remove last chip
- [x] 3.3 Add `tags` to `SubscribeInput` in `src/feeds/service.ts`; thread through `subscribeFeed()` → `upsertFeed()` + `enqueueFeed()`
- [x] 3.4 Add `TagInput` to `AddFeedModal` below the feed preview; wire to `subscribeFeed` tags param

## 4. Sidebar — tag chips

- [x] 4.1 Derive unique tag set in state (`allTags` memo); render as inline flex-wrap chip row between "Feeds" heading and "All Feeds" entry; skip rendering when no tags exist
- [x] 4.2 Add CSS for tag chips (`.sidebar .tag-chip`): font-size 12px, padding 2px 8px, border-radius 4px, surface background; active state uses accent-dim/accent colors; flex-wrap row with gap 4px
- [x] 4.3 Add touch-target CSS: `@media (any-pointer: coarse)` increases chip min-height to 36px and adjusts padding

## 5. Tag filter state and river wiring

- [x] 5.1 Add `activeTags: string[]` to `AppState`; add `toggleTag()` and `clearTags()` context methods
- [x] 5.2 Wire tag chip clicks in sidebar: click chip → `toggleTag()`; click active chip → removes from set; feed selection or "All Feeds" → `clearTags()`
- [x] 5.3 Update `River.tsx` `visibleItems()` memo: when activeTags present, filter items to feeds whose tags intersect activeTags
- [x] 5.4 `reloadItems()` already fetches `listItems(500)` for all-feeds path — covers tag mode too
- [x] 5.5 Scope feed list in sidebar when a tag is active: filter feeds by active tags with normalized comparison

## 6. Feed editor modal

- [x] 6.1 Create `FeedEditorModal` component with tag management + unsubscribe
- [x] 6.2 Wire tag changes to auto-save via `updateFeedTags()` service
- [x] 6.3 Wire unsubscribe button to two-step confirmation
- [x] 6.4 `[Done]` closes modal
- [x] 6.5 Replace `✕` with `…` on feed rows; wire to open FeedEditorModal
- [x] 6.6 Add CSS for `…` button (hover-reveal), tag chips, TagInput, touch targets

## 7. Keyboard and accessibility

- [ ] 7.1 Ensure tag chips are keyboard-focusable and activate on Enter/Space
- [ ] 7.2 Ensure feed editor modal is accessible (focus trap, Escape to close, aria-labels)
- [ ] 7.3 Ensure tag autocomplete is keyboard-navigable (arrow keys, Enter to select, Escape to dismiss)

## 8. Tests

- [x] 8.1 Add unit tests for tag normalization: trimming, whitespace collapsing, lowercasing, empty/whitespace rejection
- [x] 8.2 Add unit tests for tag filter logic: single tag, multi-tag OR, no match, all tags cleared
- [x] 8.3 Add unit tests for sync merge `newer()` with `tagsAt`: remote wins, local wins, null remote doesn't clear tags

## 9. Verification

- [x] 9.1 `npm run typecheck` passes with zero errors
- [x] 9.2 `npm run lint` passes with zero errors
- [ ] 9.3 Manual verification: start the dev server and verify the feature works end-to-end
