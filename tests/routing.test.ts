import { describe, expect, it } from 'vitest';
import { hashId, isStatsPath } from '../src/routing';

describe('routing', () => {
  it('recognizes the stats route and trailing slash', () => {
    expect(isStatsPath('/stats')).toBe(true);
    expect(isStatsPath('/stats/')).toBe(true);
    expect(isStatsPath('/')).toBe(false);
  });

  it('keeps item hash parsing separate from the stats route', () => {
    expect(hashId('feed::item')).toMatch(/^[a-z0-9]+$/);
  });

});
