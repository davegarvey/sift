## 1. Database

- [x] 1.1 Add `unsubscribeFeed(url)` to `src/db/feeds.ts` that deletes items then the feed
- [x] 1.2 Import `deleteItemsByFeed` from `./items` in feeds.ts

## 2. State

- [x] 2.1 Add `{ kind: 'confirm-unsubscribe'; feedUrl: string; feedTitle: string }` to `ModalKind` in `src/state.tsx`

## 3. Icons

- [x] 3.1 Create `src/components/Icons.tsx` with `PlusIcon` and `RefreshIcon` (extracted from `Topbar.tsx`)

## 4. Confirm Modal

- [x] 4.1 Create `src/components/ConfirmUnsubscribeModal.tsx` with confirmation message, Cancel/Confirm buttons
- [x] 4.2 Wire confirm to call `unsubscribeFeed()`, reload feeds/items, reset riverScope if needed

## 5. Sidebar

- [x] 5.1 Add hover-reveal `×` button to `FeedRow` in `src/components/Sidebar.tsx` that opens the confirm modal
- [x] 5.2 Remove the bottom add-feed bar from the sidebar

## 6. Topbar

- [x] 6.1 Add `+` button to `Topbar.tsx` that opens add-feed modal
- [ ] 6.2 Remove refresh button from Topbar — cancelled after discussion (would hide on mobile)

## 7. App Shell

- [x] 7.1 Wire `ConfirmUnsubscribeModal` in `App.tsx` for `confirm-unsubscribe` modal kind

## 8. Styles

- [x] 8.1 Add `.sidebar .feed .delete-btn` styles with hover-reveal (desktop) and always-visible (mobile) behavior
- [x] 8.2 Add `.feed-header` and `.icon-btn` styles for the new add-feed icon in topbar
- [x] 8.3 Remove `.sidebar .add-feed` styles (no longer needed)

## 9. Verify

- [x] 9.1 Run `npm run typecheck` and `npm run lint` — zero errors
- [x] 9.2 Run `npm run build` — builds successfully
- [x] 9.3 Run `npm test` — all tests pass
