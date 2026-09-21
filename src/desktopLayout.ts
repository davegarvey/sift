import {
  ARTICLE_LIST_WIDTH_DEFAULT,
  ARTICLE_LIST_WIDTH_MAX,
  ARTICLE_LIST_WIDTH_MIN,
} from './db/types';
import type { AppSettings } from './db/types';

export const DESKTOP_READING_WORKSPACE_MIN_WIDTH = 820;
export const DESKTOP_EXPANDED_NAV_MIN_WIDTH = 1300;
export const ARTICLE_LIST_WIDTH_DEFAULT_MAX = 560;
const ARTICLE_LIST_WIDTH_LEGACY_DEFAULT = 720;

export function defaultArticleListWidth(viewportWidth: number): number {
  const width = Number.isFinite(viewportWidth) ? viewportWidth : 1440;
  return Math.min(ARTICLE_LIST_WIDTH_DEFAULT_MAX, Math.max(ARTICLE_LIST_WIDTH_MIN, Math.round(width * 0.3)));
}

export function normalizeArticleListWidth(value: unknown): number {
  const width = typeof value === 'number' && Number.isFinite(value)
    ? value
    : ARTICLE_LIST_WIDTH_DEFAULT;
  return Math.min(ARTICLE_LIST_WIDTH_MAX, Math.max(ARTICLE_LIST_WIDTH_MIN, width));
}

export function normalizeFocusMode(value: unknown): boolean {
  return value === true;
}

export function normalizeDesktopLayoutSettings(
  settings: Pick<AppSettings, 'articleListWidth' | 'articleListWidthCustomized' | 'focusMode'>,
  viewportWidth = 1440,
): Pick<AppSettings, 'articleListWidth' | 'articleListWidthCustomized' | 'focusMode'> {
  const hasCustomizationFlag = typeof settings.articleListWidthCustomized === 'boolean';
  const hasLegacyCustomWidth = typeof settings.articleListWidth === 'number'
    && Number.isFinite(settings.articleListWidth)
    && settings.articleListWidth !== ARTICLE_LIST_WIDTH_LEGACY_DEFAULT;
  const articleListWidthCustomized = settings.articleListWidthCustomized === true
    || (!hasCustomizationFlag && hasLegacyCustomWidth);
  return {
    articleListWidth: articleListWidthCustomized
      ? normalizeArticleListWidth(settings.articleListWidth)
      : defaultArticleListWidth(viewportWidth),
    articleListWidthCustomized,
    focusMode: normalizeFocusMode(settings.focusMode),
  };
}

export function hasDesktopReadingWorkspace(width: number): boolean {
  return width >= DESKTOP_READING_WORKSPACE_MIN_WIDTH;
}

export function usesCollapsedFeedNavigation(width: number): boolean {
  return width >= DESKTOP_READING_WORKSPACE_MIN_WIDTH && width < DESKTOP_EXPANDED_NAV_MIN_WIDTH;
}

export function viewAfterScopeChange(view: 'river' | 'reading' | 'stats', width: number): 'river' | 'reading' {
  return view === 'reading' && hasDesktopReadingWorkspace(width) ? 'reading' : 'river';
}
