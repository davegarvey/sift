/**
 * Swipe-gesture constants and pure decision helpers for the reading view.
 * Mirrors the river swipe engine's discipline (dead zone + axis lock) so the
 * two gesture surfaces behave consistently.
 */

export const SWIPE = {
  /** Horizontal distance before any visual shift is applied. */
  DEAD_ZONE: 8,
  /** Vertical dominance threshold that bails the gesture into native scroll. */
  AXIS_LOCK: 10,
  /** Max translateX applied while following the finger (px). */
  CLAMP: 80,
  /** Horizontal distance that commits navigation (px). */
  COMMIT: 60,
  /** Screen-edge zone left to the browser's native back/forward swipe (px). */
  EDGE_ZONE: 22,
} as const;

/**
 * Resolve a horizontal displacement into a navigation offset.
 * Negative dx (swipe left) -> +1 (next); positive dx (swipe right) -> -1 (prev).
 * Returns 0 when the swipe has not crossed the commit threshold.
 */
export function swipeDirection(dx: number, commit: number = SWIPE.COMMIT): -1 | 0 | 1 {
  if (dx <= -commit) return 1;
  if (dx >= commit) return -1;
  return 0;
}

/**
 * True when vertical motion dominates and the gesture should bail to native
 * scroll before any horizontal displacement is applied.
 */
export function isVerticalDominant(dx: number, dy: number, axisLock: number = SWIPE.AXIS_LOCK): boolean {
  return Math.abs(dy) >= axisLock && Math.abs(dy) > Math.abs(dx);
}

/** Clamp a raw horizontal displacement to the finger-following limit. */
export function clampTranslate(dx: number, clamp: number = SWIPE.CLAMP): number {
  return Math.max(-clamp, Math.min(clamp, dx));
}
