## 1. Routing utilities

- [x] 1.1 Create `src/routing.ts` with `hashId`, `slugify`, `itemUrl`, and `parseItemIdFromUrl` functions

## 2. State layer changes

- [x] 2.1 Update `openItem` in `src/state.tsx` to set URL via `pushState` (or `replaceState` when `replace` param is true)
- [x] 2.2 Update `closeReading` in `src/state.tsx` to call `history.replaceState(null, '', '/')` on close
- [x] 2.3 Add boot-time URL restoration in `src/state.tsx` — parse hash from URL, look up item by hash in loaded items, open reading view if found

## 3. Component changes

- [x] 3.1 Update `ReadingView.tsx` `navigate()` to pass `replace: true` to `openItem`
- [x] 3.2 Update `App.tsx` j/k keyboard handlers to pass `replace: true` to `openItem`

## 4. Verify

- [x] 4.1 Run `npm run typecheck` and `npm run build`
- [ ] 4.2 Run `npm run dev` and manually test: open article, verify URL changes, refresh restores article, back button returns to river, bookmark URL reopens article
