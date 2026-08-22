## 1. Utility: human-readable relative time

- [x] 1.1 Add `humanRelativeTime(date: Date): string` to `src/util/time.ts` with decaying precision: "2h ago" → "last Wed" → "last month" → "Jun 2026"

## 2. Chrome simplification

- [x] 2.1 Remove feed name and relative time from the chrome in `ReadingView.tsx`
- [x] 2.2 Replace "← All" with just an arrow icon (no text)

## 3. Byline enhancement

- [x] 3.1 Add feed name to the body byline in `ReadingView.tsx`
- [x] 3.2 Replace raw date in byline with `humanRelativeTime()` call

## 4. Desktop chevron navigation

- [x] 4.1 Add ◀ ▶ chevron elements to `ReadingView.tsx`, positioned in margin gutters, vertically centered
- [x] 4.2 Add hit zone logic — entire margin strip (~50-60px) triggers hover/fade
- [x] 4.3 Wire click handlers to navigate prev/next via `ctx.jumpTo()` + `ctx.openItem()`
- [x] 4.4 Add boundary logic — ghosted at first/last, hidden when only one item
- [x] 4.5 Add CSS: faint opacity at rest, transition to full on hover

## 5. Mobile chevron navigation

- [x] 5.1 Add ◀ ▶ chevrons to the sticky chrome between back arrow and actions (mobile only)
- [x] 5.2 Wire click handlers (same as desktop path)
- [x] 5.3 Add boundary logic (same as desktop)
