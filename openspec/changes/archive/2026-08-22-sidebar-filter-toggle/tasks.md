## 1. Dependency setup

- [ ] 1.1 Add `lucide-solid` to `package.json` dependencies

## 2. Sidebar: add FilterToggle component and All Feeds row

- [ ] 2.1 Create a `FilterToggle` component in `Sidebar.tsx` — two-button segmented control with `CircleDot` (unread) and `Inbox` (all) from lucide-solid; wire click to `setState({ readFilter })` + `saveSettingsPatch` + `reloadItems()`; active segment gets `.active` class
- [ ] 2.2 Remove the old "Unread" / "All" entries (lines 51-67), `selectView`, `allActive`, and `unreadActive` from `Sidebar.tsx`
- [ ] 2.3 Add "All Feeds" as the first entry in the sidebar's feed list — sets `riverScope: null`, shows total unread count, uses `.feed` styling, participates in `onNavigate` sidebar close on mobile

## 3. CSS for the new sidebar elements

- [ ] 3.1 Add `.sidebar .filter-toggle` styles (segmented control: two buttons in a row, accent background for active, hover states, 4px border-radius)
- [ ] 3.2 Add responsive rule: hide toggle label text (`.filter-toggle .label`) on mobile viewports (max-width: 768px)
- [ ] 3.3 Add `.sidebar .all-feeds` entry styling (reuses `.feed` row styles; distinct hover/active states)

## 4. Verify

- [ ] 4.1 `npm run typecheck` passes with zero errors
- [ ] 4.2 `npm run lint` passes with zero errors
- [ ] 4.3 Manual verification: toggle switches filter and re-fetches immediately; "All Feeds" returns to all-feeds scope; filter state stays highlighted when a feed is selected; settings persist across reload
