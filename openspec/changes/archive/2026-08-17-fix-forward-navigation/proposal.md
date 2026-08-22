## Why

Browser forward navigation after viewing an article and going back does not restore the reading view — the URL changes to the article URL but the UI stays on the river. Forward should be symmetric with back: back returns to the main list, forward should return to the article.

## What Changes

- `popstate` handler in `App.tsx` will handle forward navigation: when the view is `'river'` and the URL matches an article path (`/i/<hash>`), find the item and open the reading view
- No changes to `closeReading` in `state.tsx` — `replaceState('/')` does not affect the forward history stack

## Capabilities

### New Capabilities
- `forward-navigation`: browser forward gesture restores the reading view after navigating back from an article

### Modified Capabilities

None.

## Impact

- `src/App.tsx` — expanded `onPop` handler
- `src/routing.ts` — `parseItemIdFromUrl` and `hashId` already exported; no changes needed
- No API, dependency, or breaking changes
