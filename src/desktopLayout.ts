import {
  ARTICLE_LIST_WIDTH_DEFAULT,
  ARTICLE_LIST_WIDTH_MAX,
  ARTICLE_LIST_WIDTH_MIN,
} from './db/types';
import type { AppSettings } from './db/types';

export const DESKTOP_READING_WORKSPACE_MIN_WIDTH = 820;
export const DESKTOP_EXPANDED_NAV_MIN_WIDTH = 1300;

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
  settings: Pick<AppSettings, 'articleListWidth' | 'focusMode'>,
): Pick<AppSettings, 'articleListWidth' | 'focusMode'> {
  return {
    articleListWidth: normalizeArticleListWidth(settings.articleListWidth),
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
