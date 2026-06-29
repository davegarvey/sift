## Why

The Add Feed modal currently reads `navigator.clipboard.readText()` on mount to pre-fill the URL input. This has two UX problems: (1) the clipboard read can overwrite user input if it completes after the user has started typing (race condition), and (2) input focus is delayed until the clipboard read resolves, making the modal feel sluggish. Additionally, auto-reading the clipboard without explicit user action is a privacy concern. Switching to paste-triggered auto-discover is more predictable, respects user intent, and eliminates the race condition.

## What Changes

- Remove the `navigator.clipboard.readText()` call from `onMount` in `AddFeedModal.tsx`
- Keep auto-focus on the input on mount
- Add an `onPaste` handler that triggers feed discovery automatically after the user pastes a URL
- Remove the now-unused `looksLikeUrl()` helper function

## Capabilities

### New Capabilities

(none — this modifies existing internal behavior)

### Modified Capabilities

- `feed-management`: The "add feed" scenario 8.3 is amended — the modal no longer auto-reads the clipboard on mount. Instead, pasting a URL into the input auto-triggers discovery (same flow as pressing Enter after the paste settles).

## Impact

- Only file changed: `src/components/AddFeedModal.tsx`
- No new dependencies
- No API or spec-level contract changes to server endpoints
