## 1. CSS

- [ ] 1.1 Add `.reading-chrome-inner` wrapper rule — max-width: var(--measure), centered, flex layout with padding
- [ ] 1.2 Move gap/padding from `.reading-chrome` to `.reading-chrome-inner`; keep chrome background/border full-width
- [ ] 1.3 Add `.chrome-title` rule — truncation (min-width: 0, overflow: hidden, text-overflow: ellipsis, white-space: nowrap), opacity 0, transition opacity 150ms ease-out
- [ ] 1.4 Add `.chrome-title[data-shown]` rule — opacity 1
- [ ] 1.5 Make `.chrome-spacer` a flex container with min-width: 0 and align-items: center

## 2. Component

- [ ] 2.1 Import `onCleanup` in ReadingView.tsx
- [ ] 2.2 Add `showChromeTitle` and `titleEl` signals
- [ ] 2.3 Add `containerRef` on `<main class="reading">`
- [ ] 2.4 Add `setTitleEl` ref on `<h1>`
- [ ] 2.5 Add `createEffect` for IntersectionObserver — observes h1, root = containerRef, rootMargin = '-35px', toggles showChromeTitle
- [ ] 2.6 Add `<span class="chrome-title">` inside `.chrome-spacer` with text from `currentItem()!.title` and `data-shown` attribute
- [ ] 2.7 Add `createEffect` for `document.title` — set to `"Title — Sift"` or `"Sift"`
- [ ] 2.8 Add `onCleanup` to reset `document.title` on unmount

## 3. Verify

- [ ] 3.1 Run `npm run typecheck` — zero errors
- [ ] 3.2 Run `npm run lint` — zero warnings
