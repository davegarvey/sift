/**
 * IndexedDB schema types. Lives here so the rest of the app imports a
 * single, canonical type definition for the database. See `db/open.ts`
 * for how the stores map to these types.
 */

export interface Feed {
  /** Canonical feed URL (used as the IndexedDB key). */
  url: string;
  title: string;
  /** Human-facing home page (e.g., the blog itself, not the feed). */
  htmlUrl?: string;
  /** OPML-assigned folder path (array of folder names from root to parent). */
  folder?: string[];
  /** Last successful fetch (epoch ms). */
  lastFetched: number | null;
  /** ETag received from the upstream, forwarded on next conditional request. */
  etag?: string | null;
  /** Last-Modified header from upstream, forwarded next time. */
  lastModified?: string | null;
  /** Learned refresh interval in ms. Initial: 60 min. Floor 30 min, ceiling 24 h. */
  learnedIntervalMs: number;
  /** Last error message from a refresh attempt, null if none. Surfaces in sidebar. */
  lastError?: string | null;
  /** ISO timestamp of the most recent item observed, for cadence learning. */
  lastItemPublishedAt?: number | null;
  /** Daily publish count observations used by the cadence-learning heuristic. */
  recentPublishCounts?: number[];
}

export interface Item {
  /** Stable id: `${feedUrl}::${guid}`. */
  id: string;
  feedUrl: string;
  guid: string;
  title: string;
  author?: string;
  link?: string;
  publishedAt: number;
  updatedAt: number;
  excerpt: string;
  /** Raw HTML content from the feed (may be the full body or just a summary). */
  html?: string;
  /** Full-text HTML extracted by Readability (cached). Null until extracted. */
  extractedHtml?: string | null;
  /** Epoch ms of first time the user opened this item; null if never opened. */
  firstOpenedAt?: number | null;
  read: boolean;
  starred: boolean;
  createdAt: number;
}

export interface Meta {
  key: string;
  value: unknown;
}

export interface DBSchema {
  feeds: Feed;
  items: Item;
  meta: Meta;
}

export const DB_NAME = 'sift';
export const DB_VERSION = 1;

export const DEFAULT_LEARNED_INTERVAL_MS = 60 * 60 * 1000;
export const MIN_LEARNED_INTERVAL_MS = 30 * 60 * 1000;
export const MAX_LEARNED_INTERVAL_MS = 24 * 60 * 60 * 1000;

/** Full-extract retention window (images + text). Default 7 days. */
export const FULL_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;
/** Text-only retention window. Default 30 days. */
export const TEXTONLY_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;
/** Per-feed size threshold before applying eviction. Default 50 MB. */
export const FEED_STORAGE_THRESHOLD_BYTES = 50 * 1024 * 1024;

export type ThemePreference = 'system' | 'light' | 'dark';

export interface AppSettings {
  theme: ThemePreference;
  markReadOnScrollPast: boolean;
  lastRefreshRunAt: number | null;
  lastFeedUrl: string | null;
  readFilter: 'unread' | 'all';
}

export const DEFAULT_SETTINGS: AppSettings = {
  theme: 'system',
  markReadOnScrollPast: true,
  lastRefreshRunAt: null,
  lastFeedUrl: null,
  readFilter: 'unread',
};