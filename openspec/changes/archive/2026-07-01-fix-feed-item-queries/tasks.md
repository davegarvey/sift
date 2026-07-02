## 1. Database: Add `by-published` index

- [x] 1.1 Bump `DB_VERSION` to 2 in `src/db/types.ts`
- [x] 1.2 Add `by-published: number` to `items` indexes in `src/db/open.ts` DBSchema interface
- [x] 1.3 Add `oldVersion` / `transaction` params to the upgrade callback and create `by-published` index when `oldVersion < 2`

## 2. Item queries: per-feed scoping and global interleaving

- [x] 2.1 Update `listItems()` in `src/db/items.ts` to iterate the new `by-published` index instead of `by-feed-published`, giving true chronological order
- [x] 2.2 Import `listItemsByFeed` in `src/state.tsx`
- [x] 2.3 Modify `reloadItems()` to call `listItemsByFeed(feedUrl, 500)` when `state.riverScope != null`, falling back to `listItems(500)` for "All Feeds"

## 3. Wiring: eviction after refresh

- [x] 3.1 Import `runEviction` from `../articles/eviction` in `src/feeds/scheduler.ts`
- [x] 3.2 Call `void runEviction()` after `mapConcurrent` completes in `refreshStaleFeeds()`

## 4. Verification

- [x] 4.1 Run `npm run typecheck` — zero errors
- [x] 4.2 Run `npm run lint` — zero warnings* (pre-existing issue in `.opencode/plugins/crit.ts`, not related)
- [x] 4.3 Run `npm run build` — produces `dist/`
- [x] 4.4 Run `npm test` — all 18 tests pass
