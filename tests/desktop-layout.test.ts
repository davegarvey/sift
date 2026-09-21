import { describe, expect, it } from 'vitest';
import {
  defaultArticleListWidth,
  hasDesktopReadingWorkspace,
  normalizeArticleListWidth,
  normalizeDesktopLayoutSettings,
  usesCollapsedFeedNavigation,
  viewAfterScopeChange,
} from '../src/desktopLayout';

describe('desktop reading layout settings', () => {
  it('scales the default article-list width with the viewport', () => {
    expect(defaultArticleListWidth(1024)).toBe(360);
    expect(defaultArticleListWidth(1280)).toBe(384);
    expect(defaultArticleListWidth(1440)).toBe(432);
    expect(defaultArticleListWidth(1920)).toBe(560);
    expect(defaultArticleListWidth(2560)).toBe(560);
  });

  it('uses the responsive default when no custom width is saved', () => {
    expect(normalizeDesktopLayoutSettings({}, 1440)).toEqual({
      articleListWidth: 432,
      articleListWidthCustomized: false,
      focusMode: false,
    });
  });

  it('treats the former 720px default as uncustomized but preserves deliberate widths', () => {
    expect(normalizeDesktopLayoutSettings({ articleListWidth: 720 }, 1440)).toEqual({
      articleListWidth: 432,
      articleListWidthCustomized: false,
      focusMode: false,
    });
    expect(normalizeDesktopLayoutSettings({ articleListWidth: 500 }, 1440)).toEqual({
      articleListWidth: 500,
      articleListWidthCustomized: true,
      focusMode: false,
    });
    expect(normalizeDesktopLayoutSettings({ articleListWidth: 720, articleListWidthCustomized: true }, 1440)).toEqual({
      articleListWidth: 720,
      articleListWidthCustomized: true,
      focusMode: false,
    });
  });

  it('clamps article-list widths and ignores invalid persisted values', () => {
    expect(normalizeArticleListWidth(359)).toBe(360);
    expect(normalizeArticleListWidth(500)).toBe(500);
    expect(normalizeArticleListWidth(721)).toBe(720);
    expect(normalizeArticleListWidth(Number.NaN)).toBe(432);
  });

  it('restores a valid local focus-mode preference', () => {
    expect(normalizeDesktopLayoutSettings({ articleListWidth: 500, focusMode: true })).toEqual({
      articleListWidth: 500,
      articleListWidthCustomized: true,
      focusMode: true,
    });
    expect(normalizeDesktopLayoutSettings({ articleListWidth: 500, focusMode: 'true' as unknown as boolean })).toEqual({
      articleListWidth: 500,
      articleListWidthCustomized: true,
      focusMode: false,
    });
  });

  it('retains the reader only when changing scope in the desktop workspace', () => {
    expect(viewAfterScopeChange('reading', 820)).toBe('reading');
    expect(viewAfterScopeChange('reading', 819)).toBe('river');
    expect(viewAfterScopeChange('river', 1200)).toBe('river');
    expect(viewAfterScopeChange('stats', 1200)).toBe('river');
  });

  it('uses the collapsed feed navigation only at intermediate workspace widths', () => {
    expect(hasDesktopReadingWorkspace(819)).toBe(false);
    expect(hasDesktopReadingWorkspace(820)).toBe(true);
    expect(usesCollapsedFeedNavigation(819)).toBe(false);
    expect(usesCollapsedFeedNavigation(820)).toBe(true);
    expect(usesCollapsedFeedNavigation(1299)).toBe(true);
    expect(usesCollapsedFeedNavigation(1300)).toBe(false);
  });
});
