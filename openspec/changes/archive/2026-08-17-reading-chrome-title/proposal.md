## Why

In reading view, scrolling past the article title and metadata leaves the user with zero context — the sticky chrome shows only icon buttons, and the sidebar is hidden. Users lose track of what article they're reading, especially during long-read sessions with prev/next navigation.

## What Changes

- When the `<h1>` scrolls behind the sticky chrome, the article title appears in the chrome's spacer area with a 150ms opacity fade
- The title truncates with ellipsis when space is tight (handles mobile and narrow viewports gracefully)
- `document.title` updates to "Article Title — Sift" in reading view and resets to "Sift" when returning to the river
- Desktop and mobile both get the behavior — no media-query gating

## Capabilities

### New Capabilities
- `reading-chrome-title`: Show the active article title in the reading view chrome when the front matter has scrolled off-screen. Includes truncation, fade transition, IntersectionObserver-based visibility detection, and `document.title` sync.

### Modified Capabilities
- None

## Impact

- `src/components/ReadingView.tsx` — add IntersectionObserver, chrome title element, `document.title` effect
- `src/styles.css` — add `.chrome-title` and update `.chrome-spacer` styles
