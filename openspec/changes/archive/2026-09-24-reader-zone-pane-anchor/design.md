## Context

`.reading-zone-prev` and `.reading-zone-next` are `position: fixed` so they stay put while the reader scrolls. The reader element is itself the scroll container, so absolute positioning within it would scroll the zones with the article. The next zone is unaffected because the reader always reaches the viewport's right edge.

## Goals / Non-Goals

**Goals:**
- Keep the sidebar and article list fully interactive while an article is open.
- Keep the zones fixed during scroll.

**Non-Goals:**
- Change zone width, opacity or navigation behaviour.

## Decisions

### Track the reader's left edge with a ResizeObserver

`ReadingView` observes its root element and writes `getBoundingClientRect().left` to `--reading-left`; the prev zone uses `left: var(--reading-left, 0px)`. Any change to the sidebar, article list width, focus mode or window size resizes the reader, which triggers the observer.

Alternatives considered: computing the offset in CSS from the grid variables is fragile because the article list column uses nested `minmax`/`min` expressions; CSS anchor positioning lacks cross-browser support.

## Risks / Trade-offs

- A layout change that moves the reader without resizing it would leave a stale offset. The current grid has no such case.
