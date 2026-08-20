## 1. CSS

- [x] 1.1 Add `.reading-chrome-inner` wrapper rule — max-width: var(--measure), centered, flex layout with padding
- [x] 1.2 Move gap/padding from `.reading-chrome` to `.reading-chrome-inner`; keep chrome background/border full-width
- [x] 1.3 Add `.chrome-title` rule — truncation (min-width: 0, overflow: hidden, text-overflow: ellipsis, white-space: nowrap), opacity 0, transition opacity 150ms ease-out
- [x] 1.4 Add `.chrome-title[data-shown]` rule — opacity 1
- [x] 1.5 Make `.chrome-spacer` a flex container with min-width: 0 and align-items: center

## 2. Component

- [x] 2.1 Import `onCleanup` in ReadingView.tsx
- [x] 2.2 Add `showChromeTitle` and `titleEl` signals
- [x] 2.3 Add `containerRef` on `<main class="reading">`
- [x] 2.4 Add `setTitleEl` ref on `<h1>`
- [x] 2.5 Add `createEffect` for IntersectionObserver — observes h1, root = containerRef, rootMargin = '-35px', toggles showChromeTitle
- [x] 2.6 Add `<span class="chrome-title">` inside `.chrome-spacer` with text from `currentItem()!.title` and `data-shown` attribute
- [x] 2.7 Add `createEffect` for `document.title` — set to `"Title — Sift"` or `"Sift"`
- [x] 2.8 Add `onCleanup` to reset `document.title` on unmount

## 3. Verify

- [x] 3.1 Run `npm run typecheck` — zero errors
- [x] 3.2 Run `npm run lint` — zero warnings
