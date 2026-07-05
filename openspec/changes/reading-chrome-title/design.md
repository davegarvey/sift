## Context

In reading view, the `ReadingView` component renders a sticky chrome (`<div class="reading-chrome">`) with icon-only actions (back, star, open original, shortcuts). The article title (`<h1 class="reading-title">`) and byline live in the scrollable body below. Once the user scrolls past the front matter, the chrome offers no text context — just icons. The sidebar is hidden in reading view, so there is no peripheral reference either.

## Goals / Non-Goals

**Goals:**
- Show the article title in the chrome spacer when the `<h1>` has scrolled behind the sticky chrome
- Align the chrome title with the reading column's left edge on desktop (same `--measure` constraint as the body)
- Update `document.title` to `"Title — Sift"` in reading view, reset to `"Sift"` on exit
- Fade in/out with 150ms opacity transition
- Work on both desktop and mobile (truncation handles narrow viewports)

**Non-Goals:**
- Not showing source/feed name or author in the chrome (title only)
- No changes to the river view or sidebar

## Decisions

### Scroll detection: IntersectionObserver over scroll event
**Decision**: Use IntersectionObserver on the `<h1>`, rooted at `.reading` (the scroll container), with `rootMargin: '-35px 0px 0px 0px'` (height of sticky chrome).
**Rationale**: Declarative, no scroll thrashing risk, no debouncing needed. The observer fires only when crossing the threshold — not on every scroll frame.
**Alternatives considered**: Scroll event listener — more work to debounce, more coupling to layout.

### Chrome column alignment
**Decision**: Add a `.reading-chrome-inner` wrapper inside the chrome that mirrors the reading body's column:
```css
.reading .reading-chrome-inner {
  max-width: var(--measure);
  margin: 0 auto;
  padding: 10px 24px;
  width: 100%;
  display: flex;
  align-items: center;
  gap: 12px;
}
```
The chrome's background/border remain full-width; only the content is column-constrained. On mobile (<65ch), `width: 100%` fills the chrome naturally — no media query needed.
**Rationale**: The chrome title slides out of the same x-position as the `<h1>`, creating a visual anchor.
**Alternatives considered**: Matching the body's 24px left padding directly — would work but doesn't align with the body's `max-width` centering.

### Reactive ref pattern for `<h1>`
**Decision**: Use SolidJS signal-as-ref for the `<h1>` (`const [titleEl, setTitleEl] = createSignal<HTMLHeadingElement>()`) and a `createEffect` that recreates the IntersectionObserver when the element mounts/unmounts.
**Rationale**: The `<h1>` lives inside a `<Show>` conditional, so it's removed/recreated between article navigations. A plain `let` ref wouldn't trigger effect re-execution. The signal pattern lets SolidJS track the element lifecycle naturally, with `onCleanup` inside the effect disconnecting the old observer.

### `document.title` lifecycle
**Decision**: A `createEffect` watches `currentItem()` and sets `document.title = \`${item.title} — Sift\``. An `onCleanup` at the component level resets to `"Sift"` on unmount.
**Rationale**: The effect handles mid-session navigation (prev/next), while `onCleanup` catches the final unmount when returning to the river.

## Risks / Trade-offs

- **Title flicker during navigation**: When `currentItem()` changes, loading begins, and the `<h1>` briefly leaves the DOM. The observer pauses (no target), then activates when the new `<h1>` renders at scroll position 0. In practice, the transition between articles is fast enough that the chrome title doesn't have time to meaningfully flicker. If it did, we could gate `showChromeTitle` on `!loading()`.
- **Observer root accounting for chrome height**: The rootMargin value (`-35px`) assumes the chrome stays at 34px content + 1px border. If padding or font changes, this needs updating. Could use a CSS custom property or measure dynamically, but over-engineering for a value that changes infrequently.
- **`scrollRef.scrollTo()` is a no-op**: Pre-existing issue where `scrollRef` (on `.reading-body`) is not the scroll container. Scroll-to-top on article open is coincidental (content replacement resets position). Not addressed here.
