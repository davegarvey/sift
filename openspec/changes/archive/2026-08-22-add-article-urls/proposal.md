## Why

The URL never changes when reading an article — refreshing loses the user's position, and articles can't be bookmarked or shared as links.

## What Changes

- Add URL routing for the reading view: `/i/<encoded-item-id>/<optional-title-slug>`
- The item's composite ID (`feedUrl::guid`) is base64url-encoded for the path segment; the title slug is cosmetic and ignored for routing
- On boot, parse the current URL — if it contains an item ID, look up the item in IndexedDB and open the reading view directly
- When opening an article, `history.pushState` sets the URL; navigating between articles within the reading view uses `history.replaceState`
- Closing the reading view pops back to the river URL via `history.back()`
- No server changes needed — the SPA fallback already serves `index.html` for arbitrary paths

## Capabilities

### New Capabilities
- `article-urls`: URL-based routing for individual articles, enabling refresh persistence and bookmarkable/shareable article links

### Modified Capabilities

(None — no existing specs to modify)

## Impact

- New file: `src/routing.ts` — encode/decode helpers, URL construction, slugification
- Modified: `src/state.tsx` — URL updates in `openItem`/`closeReading`, boot-time URL restoration
- Modified: `src/App.tsx` — popstate handler
- Modified: `src/components/ReadingView.tsx` — use replaceState for in-reading navigation
- No server, database, or dependency changes
