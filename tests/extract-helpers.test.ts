import { describe, it, expect } from 'vitest';
import { heroMatch, isBannerImage, isHighSignal, type ImageInfo } from '../src/articles/extract';

describe('heroMatch', () => {
  const hero = 'https://example.com/hero.jpg';

  it('matches on exact data-original-src equality', () => {
    const imgs: ImageInfo[] = [
      { src: '/img?url=https%3A%2F%2Fexample.com%2Fa.jpg', originalSrc: 'https://example.com/a.jpg' },
      { src: '/img?url=https%3A%2F%2Fexample.com%2Fhero.jpg', originalSrc: hero },
    ];
    expect(heroMatch(imgs, hero)).toBe(true);
  });

  it('matches via decode round-trip when data-original-src is absent', () => {
    const imgs: ImageInfo[] = [
      { src: `/img?url=${encodeURIComponent(hero)}`, originalSrc: null },
    ];
    expect(heroMatch(imgs, hero)).toBe(true);
  });

  it('ignores the decoded src when data-original-src is present and different', () => {
    const imgs: ImageInfo[] = [
      { src: `/img?url=${encodeURIComponent(hero)}`, originalSrc: 'https://example.com/other.jpg' },
    ];
    expect(heroMatch(imgs, hero)).toBe(false);
  });

  it('treats a decode failure as no match', () => {
    const imgs: ImageInfo[] = [{ src: '/img?url=%E0%A4%A', originalSrc: null }];
    expect(heroMatch(imgs, hero)).toBe(false);
  });

  it('returns false for empty src and no match', () => {
    expect(heroMatch([{ src: null, originalSrc: null }], hero)).toBe(false);
    expect(heroMatch([], hero)).toBe(false);
  });
});

describe('isBannerImage', () => {
  it('classifies leaderboard proportions', () => {
    expect(isBannerImage('520', '100')).toBe(true);
    expect(isBannerImage('300', '150')).toBe(true);
  });

  it('rejects below-threshold dimensions', () => {
    expect(isBannerImage('299', '150')).toBe(false);
    expect(isBannerImage('300', '151')).toBe(false);
  });

  it('rejects unit-suffixed, non-numeric, and missing attributes', () => {
    expect(isBannerImage('520px', '100px')).toBe(false);
    expect(isBannerImage('52px', '100')).toBe(false);
    expect(isBannerImage(null, '100')).toBe(false);
    expect(isBannerImage('520', null)).toBe(false);
    expect(isBannerImage('', '')).toBe(false);
  });
});

describe('isHighSignal', () => {
  const base = { inMainArticle: false, srcset: null, width: null, height: null };

  it('accepts images inside main/article', () => {
    expect(isHighSignal({ ...base, inMainArticle: true })).toBe(true);
  });

  it('accepts a 2x srcset descriptor token but not a substring', () => {
    expect(isHighSignal({ ...base, srcset: 'comic_2x.png 2x' })).toBe(true);
    expect(isHighSignal({ ...base, srcset: 'a.png 1x, b.png 2x' })).toBe(true);
    expect(isHighSignal({ ...base, srcset: 'comic_2x.png 1x' })).toBe(false);
  });

  it('accepts width and height both >= 200, rejects at the boundary', () => {
    expect(isHighSignal({ ...base, width: '200', height: '200' })).toBe(true);
    expect(isHighSignal({ ...base, width: '199', height: '200' })).toBe(false);
    expect(isHighSignal({ ...base, width: '200', height: null })).toBe(false);
  });
});
