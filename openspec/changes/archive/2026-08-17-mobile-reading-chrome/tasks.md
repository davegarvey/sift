## 1. Mobile bottom action bar

- [x] 1.1 In `ReadingView.tsx`, add a mobile-only bottom bar container after the reading body with four buttons: prev (far left), star, open, next (far right)
- [x] 1.2 Wire prev/next to the existing `navigate(-1)` / `navigate(1)` path, reusing `hasPrev()` / `hasNext()` for disabled/ghosted states and hiding both when `singleItem()`
- [x] 1.3 Remove the `mobile-only chrome-chevrons` block from the top chrome
- [x] 1.4 Reuse the existing star and open-original handlers in the bottom bar (top-chrome star/open buttons removed on mobile, kept on desktop)
- [x] 1.5 Add CSS: `.reading-bottom-bar` fixed at bottom on `≤768px`, flex layout (prev left, star/open center, next right), coarse-pointer 44px targets, safe-area inset padding, background `var(--mantle)` + top hairline
- [x] 1.6 Add bottom padding to `.reading .reading-body` on mobile equal to bar height + existing safe-area padding so content isn't permanently covered
- [x] 1.7 Confirm desktop (>768px) renders no bottom bar and keeps the current chrome + margin chevrons

## 2. Help CTA desktop-only fix

- [x] 2.1 In `src/styles.css`, remove `.reading .reading-chrome .desktop-only` from the `@media (any-pointer: coarse)` touch-target selector list so the `≤768px` `display: none` applies
- [x] 2.2 Verify on a touch device at mobile width that the help button is hidden, and on desktop it still renders and opens the shortcuts overlay

## 3. Mobile swipe navigation

- [x] 3.1 Add a touch-only pointer-event swipe handler on the reading container in `ReadingView.tsx` (gated on `pointerType === 'touch'` and `any-pointer: coarse`, mirroring the River engine)
- [x] 3.2 Dead zone (~8px) before any visual shift; axis lock bails when `|dy| >= 10 && |dy| > |dx|`; `pointercancel` cleanup resets transform
- [x] 3.3 Clamped `translateX` (~80px) follows the finger; commit navigation at ~60px (left = next, right = prev), else snap back with a transition
- [x] 3.4 Set `touch-action: pan-y` on the reading container so vertical scroll stays native
- [x] 3.5 Ignore `pointerdown` within ~20-24px of the left/right screen edge (browser back/forward edge-swipe zones)
- [x] 3.6 Skip the gesture when the touch starts on a link, button, iframe, video, or horizontally scrollable element (`pre`, overflow-x block)
- [x] 3.7 Respect boundaries via `hasPrev`/`hasNext` — no navigation at first/last item; disabled entirely when `singleItem()`

## 4. Embedded media fit

- [x] 4.1 In `src/articles/extract.ts`, add a normalization pass for `iframe`/`video`/`embed`: read `width`/`height` attributes and set inline `width:100%;height:auto;aspect-ratio:<w>/<h>`; fall back to `aspect-ratio:16/9` when attributes are missing
- [x] 4.2 Add CSS safety net: `.reading .reading-body iframe, .reading .reading-body video, .reading .reading-body embed { max-width: 100% }`
- [x] 4.3 Verify with a YouTube embed (Simon Willison's Weblog style) at 375px and 768px widths that the video fits the column with correct aspect ratio and no horizontal overflow

## 5. Verification

- [x] 5.1 `npm run typecheck` — zero errors
- [x] 5.2 `npm run lint` — zero warnings
- [x] 5.3 Manual mobile pass (≤768px): bottom bar visible, prev/next work and ghost at boundaries, swipe left/right navigates, vertical scroll never triggers swipe, edge-zone swipes still trigger browser back, back top-left works, help hidden, title gets full top row, video fits
- [x] 5.4 Manual desktop pass (>768px): unchanged layout, margin chevrons still work, help visible, no bottom bar, no swipe
