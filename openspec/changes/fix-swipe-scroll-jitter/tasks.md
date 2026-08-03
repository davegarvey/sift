## 1. Gesture engine rewrite

- [x] 1.1 In `src/components/River.tsx`, add the `SWIPE_DEAD_ZONE` (8), `SWIPE_AXIS_LOCK` (10), `SWIPE_CLAMP` (80), and `SWIPE_TRIGGER` (60) constants.
- [x] 1.2 Add the `e.pointerType !== 'touch'` early return in `onStart`.
- [x] 1.3 Reset `el.style.transform = ''` and remove `.swiping` defensively at the start of `onStart`.
- [x] 1.4 Replace `onMove` with a dead-zone + axis-lock version: no transform until |dx| > `SWIPE_DEAD_ZONE`; abort when |dy| ≥ `SWIPE_AXIS_LOCK` and |dy| > |dx|; otherwise clamp to `SWIPE_CLAMP` and translate.
- [x] 1.5 Make `cleanup()` reset `el.style.transform` and remove `.swiping` (in addition to removing listeners), so `pointercancel` is a clean no-op visually.
- [x] 1.6 In `onEnd`, base `swiped` on whether the gesture engaged (not on a separate `moved` flag) and only call `markReadAndSync` / `toggleStar` when engaged and |dx| > `SWIPE_TRIGGER`.

## 2. Verification

- [x] 2.1 `npm run typecheck` — no type errors.
- [x] 2.2 `npm run lint` — no lint errors.
- [x] 2.3 `npm test` — existing tests pass.
- [ ] 2.4 Manual: on a touch device (Pixel 7 / Firefox Android or equivalent), scroll the river vertically and confirm the touched row does not shift horizontally and the colored CTA is never revealed.
- [ ] 2.5 Manual: swipe a row left and right and confirm mark-read / star still trigger on release past the threshold; release short of the threshold springs back and opens the item on tap.
