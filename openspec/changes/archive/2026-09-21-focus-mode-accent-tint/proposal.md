## Why

The first active-state treatment used a filled neutral surface, but the user prefers the focus icon itself to carry the active cue. A pink-tinted icon keeps the toolbar visually light while making the persistent mode easy to spot.

## What Changes

- Replace the resting filled-background cue with a pink-tinted icon/foreground when focus mode is enabled.
- Keep the disabled state neutral and preserve existing hover/focus behavior.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `desktop-reading-layout`: Specify that the active focus-mode cue is a pink-tinted foreground rather than a resting highlight background.

## Impact

Updates the focus-mode toggle styling and the existing desktop-reading-layout requirement. No API, persisted data, or preference changes are required.
