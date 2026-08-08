// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { fitMediaElements } from '../src/articles/extract';

describe('fitMediaElements', () => {
  it('constrains an iframe with width/height attributes to 100% with matching aspect-ratio', () => {
    const html = '<iframe src="https://www.youtube.com/embed/x" width="560" height="315"></iframe>';
    const out = fitMediaElements(html);
    expect(out).toContain('width:100%;height:auto;aspect-ratio:560/315');
  });

  it('falls back to 16/9 when dimensions are missing', () => {
    const html = '<video src="clip.mp4"></video>';
    const out = fitMediaElements(html);
    expect(out).toContain('aspect-ratio:16/9');
  });

  it('falls back to 16/9 for non-numeric dimensions', () => {
    const html = '<iframe src="https://x.example/e" width="auto" height="100%"></iframe>';
    const out = fitMediaElements(html);
    expect(out).toContain('aspect-ratio:16/9');
  });

  it('handles embed elements', () => {
    const html = '<embed src="thing.swf" width="100" height="50">';
    const out = fitMediaElements(html);
    expect(out).toContain('aspect-ratio:100/50');
  });

  it('leaves non-media content untouched', () => {
    const html = '<p>hello <a href="#">world</a></p><img src="x.jpg">';
    expect(fitMediaElements(html)).toBe(html);
  });
});
