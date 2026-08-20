## 1. Sidebar Component

- [x] 1.1 Wrap `.tag-chips` block in `<Show when={ctx.feeds().length > 0}>` in `src/components/Sidebar.tsx`
- [x] 1.2 Wrap the feed list `<For>` with `<Show when={ctx.feeds().length > 0} fallback={<div class="feed-list-empty">No feeds, yet.</div>}>` in `src/components/Sidebar.tsx`

## 2. Styling

- [x] 2.1 Add `.sidebar .feed-list-empty` rule to `src/styles.css` (muted `--subtext`, ~12px, `padding: 4px 16px`)

## 3. Verification

- [x] 3.1 Run `npm run typecheck && npm run lint && npm test`
- [x] 3.2 Manually verify: sidebar with zero feeds shows no filter chips and the "No feeds, yet." placeholder; adding a feed restores chips and feed list
