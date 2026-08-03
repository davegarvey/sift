## Context

The river (`src/components/River.tsx`) renders each article item inside a `.swipe-container` and uses pointer events to drive a gmail-style swipe-to-reveal on touch devices. The container has `touch-action: pan-y`, so the browser owns vertical panning and dispatches `pointercancel` when it takes over the gesture. The CSS reveals two colored bars (`.swipe-reveal.left` for mark-read, `.swipe-reveal.right` for star) whenever the row's `.swipe-container` carries the `.swiping` class, which the JS toggles in response to horizontal movement.

The current handler (`onStart` → `onMove` → `onEnd` → `cleanup`) applies `translateX` on the first pixel of horizontal motion and bails out of vertical gestures only at 24px of vertical travel. `cleanup()` removes event listeners but does not reset the inline `transform` style or the `.swiping` class. Combined, this means:

- Sub-24px vertical scrolls with even a couple of pixels of horizontal jitter shift the row, revealing the colored bar.
- When the browser cancels the pointer to take over the pan, the row's transform and `.swiping` class are left in place, so the bar can stay visible after the scroll ends.

## Goals / Non-Goals

**Goals:**
- Make vertical scrolling completely inert with respect to the swipe UX.
- Keep intentional horizontal swipes behaving the same as before (same commit thresholds, same action).
- Cleanly reset gesture state on `pointercancel` (and on every `pointerdown`) so no stale transform or class survives a cancelled gesture.
- Restrict the gesture to actual touch input (exclude mouse drags on coarse-pointer devices).

**Non-Goals:**
- No changes to the swipe-reveal visuals (colored bars, icons, widths).
- No changes to the in-place read/star buttons.
- No new gestures, no velocity-based or two-stage reveals.
- No CSS changes.

## Decisions

- **Dead zone of 8px before any transform.** Below 8px of horizontal movement the handler is a no-op — no `translateX`, no `.swiping` class, no click suppression. Normal finger jitter (1–5px) during a vertical scroll is fully absorbed.
- **Axis lock at |dy| ≥ 10 and |dy| > |dx|.** As soon as vertical motion clearly dominates, the gesture aborts. The 10px threshold is chosen so the lock engages well before the 24px bail-out the old code used, and before any visible displacement has occurred (the dead zone ensures the row has not moved yet at that point).
- **Single-shot engagement.** Once the gesture is engaged (dead zone crossed), it stays engaged until `pointerup` / `pointercancel` — subsequent vertical motion no longer aborts, mirroring standard swipe-list behavior. The action threshold (60px) is well above the dead zone, so an engaged gesture that ends up mostly vertical will not commit a stray read/star.
- **`cleanup()` resets transform and `.swiping`.** This makes the `pointercancel` path (Firefox and Chrome both fire it when the browser takes over vertical panning) a clean no-op visually.
- **Defensive reset on `pointerdown`.** Clears any state that could in principle survive a prior gesture (belt-and-suspenders given the `cleanup` reset).
- **`e.pointerType === 'touch'` gate.** The existing `isTouchDevice` check (`any-pointer: coarse`) can match touchscreen laptops, where a mouse drag should not engage the touch swipe. Adding the pointer-type check excludes mouse input while keeping the gesture available for touch and stylus.
- **Constants for the thresholds.** `SWIPE_DEAD_ZONE = 8`, `SWIPE_AXIS_LOCK = 10`, `SWIPE_CLAMP = 80`, `SWIPE_TRIGGER = 60`. The clamp and trigger values are unchanged from before; only the dead zone and axis lock are new.

## Risks / Trade-offs

- **Slight click-suppression change.** The old code set the `moved` flag (used to suppress the subsequent `click` so a small drag did not also open the item) at |dx| > 6px. The new code sets the equivalent `active` flag only after the dead zone (8px). Drags in the 6–8px band that previously suppressed the click will now open the item. This is a more correct mapping (a sub-8px drag is indistinguishable from a tap with finger jitter, and taps should open the item), and the difference is imperceptible in practice.
- **No automated gesture test.** The existing test suite has no pointer-drag harness, so the fix relies on manual verification on a touch device. The change is small and the failure mode (the original bug) is easy to reproduce.
- **`isTouchDevice` is evaluated once at component render.** This is unchanged from the original code and not affected by this fix.
