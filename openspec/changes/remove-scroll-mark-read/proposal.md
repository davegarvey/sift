## Why

The scroll-past auto-mark-read behavior is surprising and unwanted — items disappear from the river without the user explicitly acting on them. Users expect items to remain unread until they open them or manually toggle them read.

## What Changes

- Remove the `IntersectionObserver`-based logic in `River.tsx` that tracks "was seen" state and fires a 500ms timer to mark items read when they scroll out of view
- Remove the `markReadOnScrollPast` setting from `AppSettings` schema, defaults, initial state, and persistence
- Remove the "Behavior" group from the Settings UI (the toggle was the only item in that group)
- Items are still marked read **immediately on open** in the reading view (unchanged)

## Capabilities

### New Capabilities
_(none — this is a removal, not a new capability)_

### Modified Capabilities
- `reader-ui`: Remove implicit mark-read on scroll from the spec. The "Implicit mark-as-read on open and on scroll" requirement SHALL be narrowed to "Implicit mark-as-read on open" only. Scenarios for scroll-past behavior SHALL be removed.

## Impact

- `src/components/River.tsx` — ~70 lines removed (IntersectionObserver, timers, onCleanup disposal, polling interval, related state)
- `src/db/types.ts` — `markReadOnScrollPast` removed from `AppSettings` interface and `DEFAULT_SETTINGS`
- `src/state.tsx` — `markReadOnScrollPast` removed from initial settings signal
- `src/components/SettingsDrawer.tsx` — Behavior group removed (`setMarkRead` function and the toggle button/label)
