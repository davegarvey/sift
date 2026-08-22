## Why

On touch devices, vertically scrolling the river (article list) causes the touched row to drift left or right by a few pixels, revealing a sliver of the colored swipe-reveal CTA underneath the row. The row can also stay in that displaced position after the scroll ends, leaving the CTA partially visible until the next touch. This makes the swipe UI feel like it triggers accidentally from normal scrolling.

The root cause is in the swipe gesture engine in `src/components/River.tsx`:

1. The `pointermove` handler applies `translateX` on the first pixel of horizontal movement — there is no dead zone, so finger jitter during a vertical scroll displaces the row immediately.
2. The vertical bail-out (`|dy| > 24`) fires only after the row has already shifted, and the bail-out path does not reset `el.style.transform` or remove the `.swiping` class.
3. When the browser takes over the vertical pan it dispatches `pointercancel`, which routes to `cleanup()` — but `cleanup()` only removes listeners and does not reset transform / class, so the row can remain displaced and the colored bar can remain visible.

## What Changes

- Rewrite the swipe gesture handler in `src/components/River.tsx` (`onStart` / `onMove` / `onEnd` / `cleanup`) so that:
  - No `translateX` or `.swiping` class is applied until horizontal movement exceeds a dead zone (8px).
  - As soon as vertical motion dominates (|dy| ≥ 10 and |dy| > |dx|), the gesture aborts before any visual displacement.
  - `cleanup()` resets `el.style.transform` to `''` and removes `.swiping`, covering the `pointercancel` path.
  - `pointerdown` defensively resets transform and class to clear any state left by a prior cancelled gesture.
  - The handler additionally requires `e.pointerType === 'touch'`, so mouse drags on touchscreen laptops do not engage the swipe.

No CSS changes. The in-place read/star action buttons and the swipe-reveal bars themselves are unchanged; only the gesture engine that drives them is tightened.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `reader-ui` — adds a requirement that the swipe gesture does not engage from vertical scroll.

## Impact

- **File changed**: `src/components/River.tsx` (gesture handler rewrite, ~30 lines).
- No CSS changes. No new components. No new dependencies.
- Desktop behavior is unchanged (`isTouchDevice` gate and `pointerType === 'touch'` gate both still exclude mouse input).
- The swipe-to-mark-read and swipe-to-star actions still trigger at the same displacement threshold (60px) once the gesture is intentionally engaged.
