## 1. Data layer — types and DB functions

- [x] 1.1 Add `lastFeedUrl: string | null` and `readFilter: 'unread' | 'all'` to `AppSettings` with safe defaults in `src/db/types.ts`
- [x] 1.2 Add `listItems(limit = 500, opts?: { unreadOnly?: boolean })` to `src/db/items.ts` that returns items across all feeds in reverse-chronological order, filtering by read state only when `unreadOnly: true`

## 2. State and persistence

- [x] 2.1 Add `readFilter` to `AppState` interface in `src/state.tsx` with default `'unread'`
- [x] 2.2 Modify `reloadItems()` in `src/state.tsx` to call `listItems()` with the current `readFilter` instead of `listUnreadAcrossFeeds()`
- [x] 2.3 Update boot sequence to restore `riverScope` and `readFilter` from persisted `AppSettings` (`lastFeedUrl`, `readFilter`)
- [x] 2.4 Ensure sidebar clicks persist `lastFeedUrl` and `readFilter` via `saveSettingsPatch()`

## 3. UI components

- [x] 3.1 Add "Unread" entry at the top of the sidebar in `src/components/Sidebar.tsx`, with total unread count badge, active state, and click handler that sets `riverScope: null, readFilter: 'unread'`
- [x] 3.2 Rewire the existing "All" entry in `src/components/Sidebar.tsx` to set `readFilter: 'all'` (instead of the current unread-only behavior), with click handler that sets `riverScope: null, readFilter: 'all'`
- [x] 3.3 Update feed entry click handlers to preserve current `readFilter` (only set `riverScope`, don't change filter)
- [x] 3.4 Update `River.tsx` empty state to conditionally show "You're all caught up" only in "Unread" mode when no unread items exist
- [x] 3.5 Ensure "All" entry in sidebar does not display a count badge

## 4. Verification

- [x] 4.1 Run `npm run typecheck` — zero errors
- [x] 4.2 Run `npm run lint` — zero warnings
- [x] 4.3 Run `npm run build` — successful production build
- [x] 4.4 Run `npm test` — all tests pass
