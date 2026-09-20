## Why

On desktop, opening an article removes both the feed navigation and article list, so switching context requires leaving the reader first. Wide screens can keep that context available while preserving a focused, article-only option for readers who prefer it.

## What Changes

- Add a desktop reading workspace with the existing feed navigation, a resizable article-list pane, and the article reader visible together.
- Keep the feed navigation's existing organization and controls; selecting a feed updates the article-list scope, and selecting an article opens it in the adjacent reader.
- Size the article-list pane from the current river width (720px maximum), allow bounded resizing, and constrain it responsively so the reader retains usable width.
- Add an icon-only focus-mode toggle to the sticky reader toolbar, with tooltips that read “Enable focus mode” and “Disable focus mode.” Focus mode hides both navigation panes and persists until toggled off.
- Remove the desktop Back CTA when the persistent-pane workspace is available. Preserve the current single-column reading flow and Back CTA on mobile.
- At intermediate desktop widths, collapse the existing feed navigation as needed while keeping the article list separate from the reader. Use the current single-column flow at mobile widths.

## Capabilities

### New Capabilities

- `desktop-reading-layout`: Desktop reading workspace, responsive panes, resizable article list, and persistent focus mode.

### Modified Capabilities

- `reader-ui`: The Back CTA remains on mobile but is replaced on desktop by persistent navigation and the focus-mode toggle.

## Impact

- Affects the app shell, feed navigation, river/article list, reading view, layout styles, and persisted local settings.
- No server/API, dependency, or database schema changes are expected.
