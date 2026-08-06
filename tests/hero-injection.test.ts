// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { injectHeroImageProxy, heroFrom } from '../src/articles/extract';

const HERO = 'https://example.com/hero.jpg';
const proxied = (original: string) => `/img?url=${encodeURIComponent(original)}`;

describe('injectHeroImageProxy', () => {
  it('injects the hero as the first child of body when the output has no images', () => {
    const out = injectHeroImageProxy('<p>just text</p>', HERO);
    expect(out).toContain(`<img src="${proxied(HERO)}" data-original-src="${HERO}"`);
    expect(out.indexOf('img')).toBeLessThan(out.indexOf('<p>'));
  });

  it('leaves the output unmodified when an image already matches the hero via data-original-src', () => {
    const html = `<p>text</p><img src="${proxied(HERO)}" data-original-src="${HERO}">`;
    expect(injectHeroImageProxy(html, HERO)).toBe(html);
  });

  it('leaves the output unmodified when the hero matches only via the decoded /img?url= src', () => {
    const html = `<p>text</p><img src="${proxied(HERO)}">`;
    expect(injectHeroImageProxy(html, HERO)).toBe(html);
  });

  it('never injects over a non-banner content image (containment gate)', () => {
    const html = `<p>text</p><img src="${proxied('https://example.com/other.jpg')}" data-original-src="https://example.com/other.jpg" width="800" height="400">`;
    expect(injectHeroImageProxy(html, HERO)).toBe(html);
  });

  it('injects the hero and drops banner images when every output image is banner-proportioned', () => {
    const html = `<p>text</p><img src="${proxied('https://example.com/b1.jpg')}" data-original-src="https://example.com/b1.jpg" width="520" height="100"><img src="${proxied('https://example.com/b2.png')}" data-original-src="https://example.com/b2.png" width="520" height="100">`;
    const out = injectHeroImageProxy(html, HERO);
    expect(out).toContain(`data-original-src="${HERO}"`);
    expect(out).not.toContain('b1.jpg');
    expect(out).not.toContain('b2.png');
  });

  it('keeps banner-proportioned images with unit-suffixed or missing attributes', () => {
    const html = `<p>text</p><img src="${proxied('https://example.com/u.jpg')}" data-original-src="https://example.com/u.jpg" width="520" height="100px">`;
    expect(injectHeroImageProxy(html, HERO)).toBe(html);
  });
});

describe('heroFrom', () => {
  it('absolutifies a relative og:image against the article URL', () => {
    expect(heroFrom('hero.jpg', 'https://example.com/story/1')).toBe('https://example.com/story/hero.jpg');
  });

  it('passes through absolute URLs unchanged', () => {
    expect(heroFrom('https://cdn.example.com/thumb.jpg')).toBe('https://cdn.example.com/thumb.jpg');
  });

  it('rejects non-http(s) schemes so the chain falls through', () => {
    expect(heroFrom('data:image/png;base64,AAAA')).toBeUndefined();
    expect(heroFrom('javascript:alert(1)')).toBeUndefined();
  });

  it('returns undefined for missing input', () => {
    expect(heroFrom(undefined)).toBeUndefined();
  });
});
