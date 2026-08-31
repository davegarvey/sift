/**
 * IndexedDB schema types. Lives here so the rest of the app imports a
 * single, canonical type definition for the database. See `db/open.ts`
 * for how the stores map to these types.
 */

export interface Feed {
  /** Stable subscription identity — generated locally, then canonicalized from sync when paired. */
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
  /** Epoch ms of last htmlUrl update, used for sync conflict resolution. */
  htmlUrlAt?: number | null;
  /** Last successful fetch (epoch ms). */
  lastFetched: number | null;
  /** Epoch ms of the last user-initiated mutation on this device (subscribe, title/tags/URL edit). Never updated by background fetches. Local-only; used as the local-authority baseline in sync conflict resolution. */
  modifiedAt?: number | null;
  /** ETag received from the upstream, forwarded on next conditional request. */
  etag?: string | null;
  /** Last-Modified header from upstream, forwarded next time. */
  lastModified?: string | null;
  /** Learned refresh interval in ms. Initial: 60 min. Floor 30 min, ceiling 24 h. */
  learnedIntervalMs: number;
  /** Last error message from a refresh attempt, null if none. Surfaces in sidebar. */
  lastError?: string | null;
  /** Local-only error-backoff state for refresh attempts. Never synced. Null when healthy. */
  refreshError?: FeedRefreshError | null;
  /** ISO timestamp of the most recent item observed, for cadence learning. */
  lastItemPublishedAt?: number | null;
  /** Daily publish count observations used by the cadence-learning heuristic. */
  recentPublishCounts?: number[];
}

export interface FeedRefreshError {
  /** Epoch ms before which the feed must not be refreshed again. */
  retryAt: number;
  /** Consecutive failure count. Increments on every failure; cleared on success. */
  attempts: number;
  /** HTTP status of the last failure (0 = network error, 200 = parse failure). */
  lastStatus: number | null;
  /** Upstream Retry-After delay in ms from the last 429, null if none. */
  lastRetryAfter: number | null;
}

export interface Item {
  /** Canonical id: `${feedId}::${guid}`. Rewritten when the feed adopts a sync identity. */
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
  /** True when `publishedAt` is the first-seen fallback, not a real feed date. */
  dateFallback?: boolean;
}

export interface FeedStats {
  feedId: string;
  totalSeen: number;
  readOnce: number;
  serverReadOnce: number;
  title: string;
  url: string;
}

export interface ReadMarker {
  id: string;
  feedId: string;
  acknowledged: 0 | 1;
}

export type StatsSortColumn = 'title' | 'totalSeen' | 'readOnce' | 'readRate' | 'expectedReads' | 'readIndex';
export type StatsSortDirection = 'asc' | 'desc';

export interface StatsSortPreference {
  column: StatsSortColumn;
  direction: StatsSortDirection;
}

export interface Meta {
  key: string;
  value: unknown;
}

export interface DBSchema {
  feeds: Feed;
  items: Item;
  meta: Meta;
  feedStats: FeedStats;
  readMarkers: ReadMarker;
}

export const DB_NAME = 'sift';
export const DB_VERSION = 9;

export const DEFAULT_LEARNED_INTERVAL_MS = 60 * 60 * 1000;
export const MIN_LEARNED_INTERVAL_MS = 30 * 60 * 1000;
export const MAX_LEARNED_INTERVAL_MS = 24 * 60 * 60 * 1000;

/** Error-backoff floor: first generic-error retry waits at least this long. */
export const ERROR_RETRY_FLOOR_MS = 30 * 60 * 1000;
/** Error-backoff ceiling for generic errors: guarantees ≥4 attempts/day while failing. */
export const ERROR_RETRY_MAX_MS = 6 * 60 * 60 * 1000;
/** Upper clamp for an honored upstream Retry-After (overrides the generic ceiling). */
export const RETRY_AFTER_CLAMP_MS = 24 * 60 * 60 * 1000;

export const STORAGE_SOFT_CAP_RATIO = 0.05;
export const EVICTION_CHUNK_SIZE = 500;

export type ThemePreference = 'system' | 'light' | 'dark';

export const SIDEBAR_WIDTH_MIN = 180;
export const SIDEBAR_WIDTH_MAX = 420;
export const SIDEBAR_WIDTH_DEFAULT = 240;

export interface AppSettings {
  theme: ThemePreference;
  highContrast: boolean;
  lastRefreshRunAt: number | null;
  lastFeedUrl: string | null;
  /** @deprecated No longer used. Kept for backward compat with persisted settings. */
  readFilter?: 'unread' | 'all';
  mcpEnabled: boolean;
  sidebarWidth?: number;
  /** 128-bit sync key as base64url (22 chars). Null = sync not enabled. */
  syncKey?: string | null;
  /** Monotonic server timestamp of the last successful pull. */
  lastSyncAt?: number | null;
  /** Monotonic server timestamp of the last successful statistics pull. */
  lastStatsSyncAt?: number | null;
  /** Server-clock offset (serverTime - Date.now()) measured at the last successful pull. */
  serverOffset?: number | null;
  statsSort?: StatsSortPreference;
}

export const DEFAULT_STATS_SORT: StatsSortPreference = {
  column: 'readOnce',
  direction: 'desc',
};

export const DEFAULT_SETTINGS: AppSettings = {
  theme: 'system',
  highContrast: false,
  lastRefreshRunAt: null,
  lastFeedUrl: null,
  mcpEnabled: false,
  sidebarWidth: SIDEBAR_WIDTH_DEFAULT,
  syncKey: null,
  lastSyncAt: null,
  lastStatsSyncAt: null,
  serverOffset: null,
  statsSort: DEFAULT_STATS_SORT,
};
