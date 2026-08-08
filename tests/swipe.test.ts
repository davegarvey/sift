import { describe, it, expect } from 'vitest';
import { SWIPE, swipeDirection, isVerticalDominant, clampTranslate } from '../src/util/swipe';

describe('swipeDirection', () => {
  it('returns +1 (next) for a leftward swipe past the commit threshold', () => {
    expect(swipeDirection(-SWIPE.COMMIT - 1)).toBe(1);
    expect(swipeDirection(-120)).toBe(1);
  });

  it('returns -1 (prev) for a rightward swipe past the commit threshold', () => {
    expect(swipeDirection(SWIPE.COMMIT + 1)).toBe(-1);
    expect(swipeDirection(120)).toBe(-1);
  });

  it('returns 0 for sub-threshold displacements', () => {
    expect(swipeDirection(0)).toBe(0);
    expect(swipeDirection(30)).toBe(0);
    expect(swipeDirection(-30)).toBe(0);
    expect(swipeDirection(SWIPE.COMMIT - 1)).toBe(0);
  });

  it('honors an explicit commit threshold', () => {
    expect(swipeDirection(100, 200)).toBe(0);
    expect(swipeDirection(200, 200)).toBe(-1);
  });
});

describe('isVerticalDominant', () => {
  it('bails when vertical motion dominates', () => {
    expect(isVerticalDominant(3, 20)).toBe(true);
    expect(isVerticalDominant(-3, -20)).toBe(true);
  });

  it('does not bail when horizontal motion is dominant or dy is below the axis lock', () => {
    expect(isVerticalDominant(20, 5)).toBe(false);
    expect(isVerticalDominant(15, 10)).toBe(false);
    expect(isVerticalDominant(0, 0)).toBe(false);
    expect(isVerticalDominant(5, 8)).toBe(false);
  });
});

describe('clampTranslate', () => {
  it('clamps to the finger-following limit', () => {
    expect(clampTranslate(-500)).toBe(-SWIPE.CLAMP);
    expect(clampTranslate(500)).toBe(SWIPE.CLAMP);
    expect(clampTranslate(40)).toBe(40);
    expect(clampTranslate(-40)).toBe(-40);
  });
});
