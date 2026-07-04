## Why

Reading articles is the core experience, but navigating between them relies entirely on j/k keyboard shortcuts — invisible to new users and unavailable on touch. Adding subtle prev/next chevrons makes the reader more approachable while keeping the clean reading aesthetic.

## What Changes

- **Desktop**: Hover-reveal ◀ ▶ chevrons in the left/right margin gutters, vertically centered in the viewport. Faint at rest (low opacity), transition to full opacity on hover. Entire margin strip (~50-60px from viewport edge) acts as hit zone.
- **Mobile (and touch)**: Always-visible ◀ ▶ chevrons in the sticky chrome, ghosted at boundaries.
- **Chrome simplification**: Remove the feed name and relative time from the chrome. Replace "← All" with just a back arrow (no text).
- **Byline enhancement**: Move feed name into the byline alongside the author. Replace raw date stamps with human-readable relative time ("2h ago", "last Wed", "last month", "Jun 2026").
- **Boundary handling**: Chevrons ghosted (disabled appearance) at first/last item. Hidden entirely when only one item in results.

## Capabilities

### New Capabilities
- `reader-nav-chevrons`: Visual prev/next navigation between articles in reading view, with desktop hover-reveal and mobile chrome placement.

### Modified Capabilities
None — this is a new capability.

## Impact

- `src/components/ReadingView.tsx` — add chevron elements, chrome cleanup, byline changes
- `src/styles.css` — chevron positioning, hover animations, mobile chrome layout
- `src/App.tsx` — may need minor adjustments if chevron click handling doesn't route through existing j/k path
- `src/state.tsx` — possibly unaffected (reuses `jumpTo`/`openItem`)
- `src/util/time.ts` — add human-readable relative date formatter
