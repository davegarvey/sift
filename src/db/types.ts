/**
 * IndexedDB schema types. Lives here so the rest of the app imports a
 * single, canonical type definition for the database. See `db/open.ts`
 * for how the stores map to these types.
 */

export interface Feed {
  /** Stable UUID — primary key, never changes. Generated at subscribe time. */
  id: string;
  /** Feed fetch URL (mutable — user may edit it). */
  url: string;
  title: string;
  /** Epoch ms of last title edit, used for sync conflict resolution. */
  titleAt?: number | null;
  /** Epoch ms of last URL edit, used for sync conflict resolution. */
  urlAt?: number | null;
  /** Human-facing home page (e.g., the blog itself, not the feed). */
  htmlUrl?: string;
  /** @deprecated OPML-assigned folder path — no longer written. Kept for backward compat during transition. */
  folder?: string[];
  /** User-assigned tags. Stored normalized (trimmed, whitespace-collapsed, lowercase). */
  tags?: string[];
  /** Epoch ms of last tag edit, used for sync conflict resolution. */
  tagsAt?: number | null;
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
  /** Stable id: `${feedId}::${guid}`. */
  id: string;
  feedId: string;
  guid: string;
  title: string;
  author?: string;
  link?: string;
  publishedAt: number;
  updatedAt: number;
  excerpt: string;
  /** Raw HTML content from the feed (may be the full body or just a summary). */
  html?: string;
  /** Thumbnail image URL from the feed's media:thumbnail or media:content. */
  thumbnail?: string | null;
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
export const DB_VERSION = 6;

export const DEFAULT_LEARNED_INTERVAL_MS = 60 * 60 * 1000;
export const MIN_LEARNED_INTERVAL_MS = 30 * 60 * 1000;
export const MAX_LEARNED_INTERVAL_MS = 24 * 60 * 60 * 1000;

export const STORAGE_SOFT_CAP_RATIO = 0.05;
export const EVICTION_CHUNK_SIZE = 500;

export type ThemePreference = 'system' | 'light' | 'dark';

export interface AppSettings {
  theme: ThemePreference;
  highContrast: boolean;
  lastRefreshRunAt: number | null;
  lastFeedUrl: string | null;
  /** @deprecated No longer used. Kept for backward compat with persisted settings. */
  readFilter?: 'unread' | 'all';
  mcpEnabled: boolean;
  /** 128-bit sync key as base64url (22 chars). Null = sync not enabled. */
  syncKey?: string | null;
  /** Monotonic server timestamp of the last successful pull. */
  lastSyncAt?: number | null;
}

export const DEFAULT_SETTINGS: AppSettings = {
  theme: 'system',
  highContrast: false,
  lastRefreshRunAt: null,
  lastFeedUrl: null,
  mcpEnabled: false,
  syncKey: null,
  lastSyncAt: null,
};