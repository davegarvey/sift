## Why

When returning from reading view to the river, the scroll to the previously focused item animates smoothly, creating a perceptible "catching up" effect. The user expects to land exactly where they were, instantly — the scroll should feel like a snap, not a transition.

## What Changes

- Make the `scrollIntoView` call in River's `createEffect` use `behavior: 'instant'` instead of deferring to CSS `scroll-behavior: smooth`
- Combine the return-to-item scroll into a single effect pass so the scroll happens immediately on mount, not after an extra render cycle
- Restructure `closeReading` in state to switch the view to river before awaiting `reloadItems`, eliminating the perceptual delay between pressing back and seeing the river

## Capabilities

### New Capabilities
- `instant-return-scroll`: Instant scroll-to-item when returning from reading view to river

### Modified Capabilities

None.

## Impact

- `src/components/River.tsx` — modify return-to-item logic in `createEffect`
- `src/state.tsx` — restructure `closeReading` to switch view before reload
