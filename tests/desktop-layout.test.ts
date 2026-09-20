import { describe, expect, it } from 'vitest';
import {
  hasDesktopReadingWorkspace,
  normalizeArticleListWidth,
  normalizeDesktopLayoutSettings,
  usesCollapsedFeedNavigation,
  viewAfterScopeChange,
} from '../src/desktopLayout';

describe('desktop reading layout settings', () => {
  it('defaults the article list to 720px and focus mode off', () => {
    expect(normalizeDesktopLayoutSettings({})).toEqual({ articleListWidth: 720, focusMode: false });
  });

  it('clamps article-list widths and ignores invalid persisted values', () => {
    expect(normalizeArticleListWidth(359)).toBe(360);
    expect(normalizeArticleListWidth(500)).toBe(500);
    expect(normalizeArticleListWidth(721)).toBe(720);
    expect(normalizeArticleListWidth(Number.NaN)).toBe(720);
  });

  it('restores a valid local focus-mode preference', () => {
    expect(normalizeDesktopLayoutSettings({ articleListWidth: 500, focusMode: true })).toEqual({ articleListWidth: 500, focusMode: true });
    expect(normalizeDesktopLayoutSettings({ articleListWidth: 500, focusMode: 'true' as unknown as boolean })).toEqual({ articleListWidth: 500, focusMode: false });
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
