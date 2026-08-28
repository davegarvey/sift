import { createSignal, createMemo, createContext, useContext } from 'solid-js';
import type { ParentComponent } from 'solid-js';
import { createStore } from 'solid-js/store';
import { listFeeds } from './db/feeds';
import { listItems, listItemsByFeed, listStarred, markRead, toggleStar as dbToggleStar } from './db/items';
import type { Feed, Item } from './db/types';
import { itemUrl, parseItemIdFromUrl, hashId, isStatsPath } from './routing';
import { getMeta, setMeta } from './db/meta';
import { DEFAULT_SETTINGS, DEFAULT_STATS_SORT, SIDEBAR_WIDTH_DEFAULT, SIDEBAR_WIDTH_MAX, SIDEBAR_WIDTH_MIN } from './db/types';
import type { AppSettings, StatsSortColumn, StatsSortDirection, StatsSortPreference, ThemePreference } from './db/types';

const SETTINGS_KEY = 'settings';

function isStatsSortColumn(value: unknown): value is StatsSortColumn {
  return value === 'title'
    || value === 'totalSeen'
    || value === 'readOnce'
    || value === 'readRate'
    || value === 'expectedReads'
    || value === 'readIndex';
}

function isStatsSortDirection(value: unknown): value is StatsSortDirection {
  return value === 'asc' || value === 'desc';
}

function normalizeStatsSort(value: unknown): StatsSortPreference {
  if (typeof value !== 'object' || value === null) return DEFAULT_STATS_SORT;
  const candidate = value as { column?: unknown; direction?: unknown };
  if (!isStatsSortColumn(candidate.column) || !isStatsSortDirection(candidate.direction)) return DEFAULT_STATS_SORT;
  return { column: candidate.column, direction: candidate.direction };
}

async function getSettings(): Promise<AppSettings> {
  const stored = await getMeta<Partial<AppSettings>>(SETTINGS_KEY, {});
  const sidebarWidth = typeof stored.sidebarWidth === 'number' && Number.isFinite(stored.sidebarWidth)
    ? stored.sidebarWidth
    : SIDEBAR_WIDTH_DEFAULT;
  const statsSort = normalizeStatsSort(stored.statsSort);
  return {
    ...DEFAULT_SETTINGS,
    ...stored,
    sidebarWidth: Math.min(SIDEBAR_WIDTH_MAX, Math.max(SIDEBAR_WIDTH_MIN, sidebarWidth)),
    statsSort,
  };
}

async function saveSettings(settings: AppSettings): Promise<void> {
  await setMeta(SETTINGS_KEY, settings);
}
import { refreshStaleFeeds, fetchingState, startScheduler, setOnRefresh } from './feeds/scheduler';
import { enqueueFlag, clearAllDirty, enqueueStatsIfSync, enqueueReadMarkerIfSync } from './sync/queue';
import { scheduleFlush, flushNow } from './sync/push';
import { bootSync, pullIfStale, pullNow, triggerFirstTime } from './sync/init';
import { setOnSync } from './sync/merge';
import { getStoredSyncKey, isValidSyncKey, generateSyncKey, setStoredSyncKey } from './sync/key';
import { redeemCode, register, rotateSyncKey } from './sync/client';
import { subscribeFeed as subscribeFeedSvc, unsubscribeFeed as unsubscribeFeedSvc, updateFeedMeta, changeFeedUrl, type SubscribeInput } from './feeds/service';
import { refreshTargetForSelection } from './feeds/scope';
import { isIdle, onCatchup, clearActivityOnHide } from './util/idle';
import { getFeedStats, getReadMarker } from './db/stats';

type ViewKind = 'river' | 'reading' | 'stats';
type ModalKind =
  | { kind: 'none' }
  | { kind: 'palette' }
  | { kind: 'shortcuts' }
  | { kind: 'settings' }
  | { kind: 'add-feed'; url?: string }
  | { kind: 'feed-editor'; feedId: string }
  | { kind: 'pair-result'; success: boolean; message: string }
  | { kind: 'confirm'; title: string; message: string; hint?: string; confirmLabel: string; danger?: boolean; onConfirm: () => void | Promise<void>; returnTo?: ModalKind }
  | { kind: 'pair-device' }
  | { kind: 'agents' }
  ;

export interface AppState {
  view: ViewKind;
  /** The feed ID the river is currently scoped to; null = All. */
  riverScope: string | null;
  /** Active tag filters (OR semantics). Mutually exclusive with riverScope. */
  activeTags: string[];
  /** "current" item being viewed in the reading view; null when in river. */
  currentItem: Item | null;
  sidebarOpen: boolean;
  sidebarHiddenDesktop: boolean;
  sidebarWidth?: number;
  focusedIndex: number;
  /** When true, only starred items are shown. Orthogonal to riverScope/activeTags. */
  starredOnly: boolean;
  modal: ModalKind;
  /** Item ID to restore focus to when returning to the river. */
  returnToItemId: string | null;
}

export interface AppContext {
  state: AppState;
  setState: (patch: Partial<AppState>) => void;
  feeds: () => Feed[];
  feedMap: () => Map<string, Feed>;
  items: () => Item[];
  allTags: () => string[];
  activeTagSet: () => Set<string>;
  settings: () => AppSettings;
  fetching: () => number;
  feedErrors: () => Record<string, string>;
  fetchingFeeds: () => Set<string>;
  hydrated: () => boolean;
  reloadFeeds: () => Promise<Feed[]>;
  reloadItems: () => Promise<void>;
  setRiverScope: (feedId: string | null) => void;
  toggleTag: (tag: string) => void;
  clearTags: () => void;
  toggleStarFilter: () => void;
  openItem: (item: Item, replace?: boolean) => Promise<void>;
  closeReading: () => Promise<void>;
  toggleSidebar: () => void;
  toggleSidebarDesktop: () => void;
  openModal: (modal: ModalKind) => void;
  closeModal: () => void;
  jumpTo: (offset: number) => void;
  refreshSelected: () => Promise<void>;
  refreshFeeds: (feedIds: readonly string[]) => Promise<void>;
  saveSettingsPatch: (patch: Partial<AppSettings>) => Promise<void>;
  mcpAvailable: () => boolean;
  mcpConnected: () => boolean;
  mcpNotifySync: () => Promise<void>;
  enableSync: () => Promise<void>;
  disableSync: () => Promise<void>;
  pairSyncWithKey: (key: string) => Promise<void>;
  regenerateSyncKey: () => Promise<void>;
  syncNow: () => Promise<void>;
  syncKey: () => string | null;
  subscribeFeed: (input: SubscribeInput) => Promise<void>;
  unsubscribeFeed: (feedId: string) => Promise<void>;
  updateFeedMeta: (feedId: string, meta: { title?: string; tags?: string[] }) => Promise<void>;
  changeFeedUrl: (feedId: string, newUrl: string) => Promise<void>;
  updateFeedTags: (feedId: string, tags: string[]) => Promise<void>;
  markReadAndSync: (item: Item, read: boolean) => Promise<void>;
  toggleStar: (item: Item) => Promise<void>;
  statsRevision: () => number;
  openStats: () => void;
}

const Ctx = createContext<AppContext>();

export const useApp = (): AppContext => {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useApp must be used within AppProvider');
  return ctx;
};

export const AppProvider: ParentComponent = (props) => {
  const [state, setStateInternal] = createStore<AppState>({
    view: typeof window !== 'undefined' && isStatsPath(window.location.pathname) ? 'stats' : 'river',
    riverScope: null,
    activeTags: [],
    currentItem: null,
    sidebarOpen: false,
    sidebarHiddenDesktop: false,
    sidebarWidth: SIDEBAR_WIDTH_DEFAULT,
    focusedIndex: -1,
    starredOnly: false,
    modal: { kind: 'none' },
    returnToItemId: null,
  });

  const setState = (patch: Partial<AppState>) => setStateInternal(patch as Partial<AppState>);

  const [feeds, setFeeds] = createSignal<Feed[]>([]);
  const [manualFetching, setManualFetching] = createSignal(0);
  const feedMap = createMemo(() => new Map(feeds().map((f) => [f.id, f])));
  const allTags = createMemo(() => {
    const seen = new Set<string>();
    for (const f of feeds()) {
      for (const t of f.tags ?? []) seen.add(t);
    }
    return [...seen];
  });
  const activeTagSet = createMemo(() => new Set(state.activeTags));
  const [items, setItems] = createSignal<Item[]>([]);
  /** True once the boot sequence has finished reading feeds/items from IndexedDB. */
  const [hydrated, setHydrated] = createSignal(false);
  const [statsRevision, setStatsRevision] = createSignal(0);
  const [settings, setSettings] = createSignal<AppSettings>({
    theme: 'system',
    highContrast: false,
    lastRefreshRunAt: null,
    lastFeedUrl: null,
    mcpEnabled: false,
    statsSort: { ...DEFAULT_STATS_SORT },
  });

  const [mcpAvailable, setMcpAvailable] = createSignal(false);
  const [mcpConnected, setMcpConnected] = createSignal(false);
  let mcpEventSource: EventSource | null = null;

  const startMcp = () => {
    if (mcpEventSource) return;
    mcpEventSource = new EventSource('/api/events');

    mcpEventSource.addEventListener('add-feed', async (e) => {
      const data = JSON.parse(e.data);
      if (typeof data.feed?.url !== 'string') return;
      try {
        const feed = data.feed as Feed;
        await subscribeFeedCtx({
          url: feed.url,
          title: feed.title,
          folder: feed.folder,
          htmlUrl: feed.htmlUrl,
        });
        await fetch('/api/events', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ kind: 'ack', id: data.id }),
        });
      } catch {}
    });

    mcpEventSource.addEventListener('remove-feed', async (e) => {
      const data = JSON.parse(e.data);
      if (typeof data.url !== 'string') return;
      try {
        const feed = feedMap().get(data.url);
        if (feed) {
          await unsubscribeFeedCtx(feed.id);
        }
        await fetch('/api/events', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ kind: 'ack', id: data.id }),
        });
      } catch {}
    });

    mcpEventSource.addEventListener('keepalive', () => {});

    mcpEventSource.onopen = () => {
      setMcpConnected(true);
      void mcpNotifySync();
    };

    mcpEventSource.onerror = () => {
      setMcpConnected(false);
    };
  };

  const stopMcp = () => {
    if (mcpEventSource) {
      mcpEventSource.close();
      mcpEventSource = null;
    }
    setMcpConnected(false);
  };

  const mcpNotifySync = async () => {
    const es = mcpEventSource;
    if (!es || es.readyState !== EventSource.OPEN) return;
    try {
      const feeds = await listFeeds();
      await fetch('/api/events', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ kind: 'sync', feeds }),
      });
    } catch {}
  };

  const markReadAndSync = async (item: Item, read: boolean) => {
    await markRead(item.id, read);
    setItems(items().map((i) => i.id === item.id ? { ...i, read } : i));
    const now = Date.now();
    enqueueFlag({
      itemId: item.id,
      feedId: item.feedId,
      read: read ? 1 : 0,
      readAt: now,
      starred: item.starred ? 1 : 0,
      starredAt: now,
    });
    if (read) {
      const [stats, marker] = await Promise.all([getFeedStats(item.feedId), getReadMarker(item.id)]);
      if (stats) {
        await enqueueStatsIfSync({
          feedId: item.feedId,
          totalSeen: stats.totalSeen,
          feedUrl: stats.url,
          title: stats.title,
        });
      }
      if (marker?.acknowledged === 0) {
        await enqueueReadMarkerIfSync({ itemId: marker.id, feedId: marker.feedId });
      }
    }
    scheduleFlush();
  };

  const toggleStarAndSync = async (item: Item) => {
    await dbToggleStar(item.id);
    const starred = !item.starred;
    setItems(items().map((i) => i.id === item.id ? { ...i, starred } : i));
    const now = Date.now();
    enqueueFlag({
      itemId: item.id,
      feedId: item.feedId,
      read: item.read ? 1 : 0,
      readAt: now,
      starred: starred ? 1 : 0,
      starredAt: now,
    });
    scheduleFlush();
  };

  const reloadFeeds = async () => {
    const next = await listFeeds();
    setFeeds(next);
    setStatsRevision((revision) => revision + 1);
    return next;
  };

  let reloadItemsPromise: Promise<void> | null = null;
  const reloadItems = async () => {
    if (reloadItemsPromise) return reloadItemsPromise;
    const reload = (async () => {
      if (state.starredOnly && state.riverScope == null && state.activeTags.length === 0) {
        setItems(await listStarred(500));
      } else if (state.riverScope != null) {
        setItems(await listItemsByFeed(state.riverScope, 500));
      } else {
        setItems(await listItems(500));
      }
    })();
    reloadItemsPromise = reload;
    try {
      await reload;
    } finally {
      if (reloadItemsPromise === reload) reloadItemsPromise = null;
    }
  };

  const setRiverScope = (feedId: string | null) => {
    if (state.view === 'stats') history.pushState(null, '', '/');
    setState({ riverScope: feedId, activeTags: [], focusedIndex: -1, view: 'river' });
  };

  const openStats = () => {
    if (state.view !== 'stats') history.pushState(null, '', '/stats');
    setState({ view: 'stats', currentItem: null, sidebarOpen: false, focusedIndex: -1 });
  };

  const toggleTag = (tag: string) => {
    const current = state.activeTags;
    const idx = current.indexOf(tag);
    if (idx >= 0) {
      const next = current.filter((t) => t !== tag);
      setState({ activeTags: next, riverScope: null, focusedIndex: -1 });
      if (next.length > 0) void reloadItems();
    } else {
      setState({ activeTags: [...current, tag], riverScope: null, focusedIndex: -1 });
      void reloadItems();
    }
  };

  const toggleStarFilter = () => {
    setState({ starredOnly: !state.starredOnly, focusedIndex: -1 });
    void reloadItems();
  };

  const clearTags = () => {
    if (state.activeTags.length === 0) return;
    setState({ activeTags: [], focusedIndex: -1 });
    void reloadItems();
  };

  const openItem = async (item: Item, replace = false) => {
    const idx = items().findIndex((i) => i.id === item.id);
    setState({ view: 'reading', currentItem: item, sidebarOpen: false, returnToItemId: item.id, focusedIndex: idx });
    if (replace) {
      history.replaceState(null, '', itemUrl(item));
    } else {
      history.pushState(null, '', itemUrl(item));
    }
    if (!item.read) {
      await markReadAndSync(item, true);
    }
  };

  const closeReading = async () => {
    setState({ view: 'river', currentItem: null });
    history.replaceState(null, '', '/');
    try {
      await reloadItems();
    } catch {
      // reload failure is non-fatal
    }
  };

  const toggleSidebar = () => setState({ sidebarOpen: !state.sidebarOpen, sidebarHiddenDesktop: false });
  const toggleSidebarDesktop = () =>
    setState({ sidebarHiddenDesktop: !state.sidebarHiddenDesktop });

  const openModal = (modal: ModalKind) => setState({ modal });
  const closeModal = () => setState({ modal: { kind: 'none' } });

  const jumpTo = (offset: number) => {
    const list = items();
    if (list.length === 0) return;
    let idx = state.focusedIndex;
    if (idx < 0) {
      const els = document.querySelectorAll<HTMLElement>('[data-item-idx]');
      let closest = 0;
      let closestDist = Infinity;
      const viewportCenter = window.innerHeight / 2;
      els.forEach((el) => {
        const rect = el.getBoundingClientRect();
        const dist = Math.abs(rect.top + rect.height / 2 - viewportCenter);
        const itemIdx = parseInt(el.dataset.itemIdx ?? '0');
        if (dist < closestDist) {
          closestDist = dist;
          closest = itemIdx;
        }
      });
      idx = closest;
    }
    const next = Math.max(0, Math.min(list.length - 1, idx + offset));
    setState({ focusedIndex: next });
  };

  let manualRefreshTail = Promise.resolve();
  let activeManualRefresh: Promise<void> | null = null;
  let manualRefreshDepth = 0;

  const performManualRefresh = async (target: ReadonlySet<string>, syncFirst: boolean): Promise<void> => {
    setManualFetching((n) => n + 1);
    manualRefreshDepth++;
    let refreshError: unknown = null;
    let reloadError: unknown = null;
    let refreshFailed = false;
    let reloadFailed = false;
    try {
      if (syncFirst) {
        try {
          await pullNow();
        } catch {
          // Sync server unreachable — continue with local feeds only.
        }
      }
      try {
        await refreshStaleFeeds({ forceAll: true, target });
      } catch (error) {
        refreshError = error;
        refreshFailed = true;
      }
      try {
        await reloadFeeds();
      } catch (error) {
        reloadError = error;
        reloadFailed = true;
      }
      try {
        await reloadItems();
      } catch (error) {
        if (!reloadFailed) {
          reloadError = error;
          reloadFailed = true;
        }
      }
      if (refreshFailed) throw refreshError;
      if (reloadFailed) throw reloadError;
    } finally {
      manualRefreshDepth = Math.max(0, manualRefreshDepth - 1);
      setManualFetching((n) => Math.max(0, n - 1));
    }
  };

  const enqueueManualRefresh = (target: ReadonlySet<string>, syncFirst: boolean, coalesce: boolean): Promise<void> => {
    if (coalesce && activeManualRefresh) return activeManualRefresh;
    const operation = manualRefreshTail.then(() => performManualRefresh(target, syncFirst));
    manualRefreshTail = operation.catch(() => {});
    activeManualRefresh = operation;
    void operation.then(
      () => { if (activeManualRefresh === operation) activeManualRefresh = null; },
      () => { if (activeManualRefresh === operation) activeManualRefresh = null; },
    );
    return operation;
  };

  const refreshSelected = () => enqueueManualRefresh(
    refreshTargetForSelection(feeds(), state.riverScope, state.activeTags),
    true,
    true,
  );

  const refreshFeeds = (feedIds: readonly string[]) => enqueueManualRefresh(new Set(feedIds), false, false);

  const reloadBoth = () => { void reloadFeeds(); void reloadItems(); };

  const toggleStar = async (item: Item) => {
    await toggleStarAndSync(item);
    await reloadItems();
  };

  const saveSettingsPatch = async (patch: Partial<AppSettings>) => {
    const next = { ...settings(), ...patch };
    setSettings(next);
    await saveSettings(next);
    if ('theme' in patch || 'highContrast' in patch) {
      applyTheme(next.theme, next.highContrast);
    }
    if ('mcpEnabled' in patch) {
      if (patch.mcpEnabled && mcpAvailable()) {
        startMcp();
      } else if (!patch.mcpEnabled) {
        stopMcp();
      }
    }
  };

  const updateSettingsWith = async (patch: Partial<AppSettings>) => {
    const next = { ...settings(), ...patch };
    setSettings(next);
    await saveSettings(next);
  };

  const enableSync = async () => {
    let key = await getStoredSyncKey();
    if (!key) {
      key = generateSyncKey();
      await setStoredSyncKey(key);
    }
    await updateSettingsWith({ syncKey: key });
    try {
      // runFirstTimeSetup registers the key before its first pull.
      await triggerFirstTime();
    } catch (e) {
      await disableSync();
      throw e;
    }
  };

  const disableSync = async () => {
    await updateSettingsWith({ syncKey: null, lastSyncAt: null, lastStatsSyncAt: null, serverOffset: null });
    clearAllDirty();
  };

  const pairSyncWithKey = async (key: string) => {
    if (!isValidSyncKey(key)) {
      throw new Error('Invalid sync key format');
    }
    await setStoredSyncKey(key);
    await updateSettingsWith({ syncKey: key });
    try {
      // runFirstTimeSetup registers the key before its first pull.
      await triggerFirstTime();
    } finally {
      await reloadFeeds();
      await reloadItems();
    }
  };

  const regenerateSyncKey = async () => {
    const oldKey = await getStoredSyncKey();
    const newKey = generateSyncKey();
    await setStoredSyncKey(newKey);
    await updateSettingsWith({ syncKey: newKey });
    if (!oldKey) return;
    try {
      // Server-side rotation: registers the new key and permanently deads
      // the old one (all agent tokens orphaned, register refuses to
      // resurrect it). Local rotation still succeeds if this fails.
      await rotateSyncKey(oldKey, newKey);
    } catch (e) {
      console.error('Failed to rotate sync key on server:', e);
    }
  };

  const syncNow = async () => {
    await pullNow();
    await flushNow();
  };

  const syncKey = (): string | null => {
    const k = settings().syncKey;
    return isValidSyncKey(k ?? null) ? (k as string) : null;
  };

  const subscribeFeedCtx = async (input: SubscribeInput) => {
    await subscribeFeedSvc(input);
    await reloadFeeds();
    await reloadItems();
  };

  const unsubscribeFeedCtx = async (feedId: string) => {
    await unsubscribeFeedSvc(feedId);
    if (state.riverScope === feedId) {
      setRiverScope(null);
    }
    await reloadFeeds();
    await reloadItems();
  };

  const value: AppContext = {
    state,
    setState,
    feeds,
    feedMap,
    items,
    allTags,
    activeTagSet,
    settings,
    fetching: manualFetching,
    feedErrors: fetchingState.feedErrors,
    fetchingFeeds: fetchingState.fetchingFeeds,
    hydrated,
    reloadFeeds,
    reloadItems,
    setRiverScope,
    toggleTag,
    clearTags,
    toggleStarFilter,
    openItem,
    closeReading,
    toggleSidebar,
    toggleSidebarDesktop,
    openModal,
    closeModal,
    jumpTo,
    refreshSelected,
    refreshFeeds,
    saveSettingsPatch,
    mcpAvailable,
    mcpConnected,
    mcpNotifySync,
    enableSync,
    disableSync,
    pairSyncWithKey,
    regenerateSyncKey,
    syncNow,
    syncKey,
    subscribeFeed: subscribeFeedCtx,
    unsubscribeFeed: unsubscribeFeedCtx,
    updateFeedMeta,
    changeFeedUrl,
    updateFeedTags: (feedId, tags) => updateFeedMeta(feedId, { tags }),
    markReadAndSync,
    toggleStar,
    statsRevision,
    openStats,
  };

  // Boot: load settings + initial feeds/items, then kick the scheduler.
  // The `finally` guarantees the loading state is released even if any
  // boot step rejects (e.g. a blocked IndexedDB open).
  void (async () => {
    const s = await getSettings();
    setSettings(s);
    applyTheme(s.theme, s.highContrast);

    try {
      const capRes = await fetch('/api/capabilities');
      if (capRes.ok) {
        const cap: { mcp?: boolean } = await capRes.json() as { mcp?: boolean };
        if (cap.mcp === true) {
          setMcpAvailable(true);
          if (s.mcpEnabled) startMcp();
        }
      }
    } catch {}

    await reloadFeeds();
    const matchingFeed = s.lastFeedUrl ? feeds().find((f) => f.url === s.lastFeedUrl) : undefined;
    const validFeedId = matchingFeed?.id ?? null;
    setState({ riverScope: validFeedId, sidebarWidth: s.sidebarWidth });
    await reloadItems();
    const hash = parseItemIdFromUrl();
    if (hash) {
      const item = items().find(i => hashId(i.id) === hash);
      if (item) {
        setState({ view: 'reading', currentItem: item, sidebarOpen: false, returnToItemId: item.id });
        if (!item.read) {
          await markReadAndSync(item, true);
        }
      }
    }
    startScheduler();
    setOnRefresh(() => { if (manualRefreshDepth === 0 && !isIdle()) reloadBoth(); });
    setOnSync(() => { if (manualRefreshDepth === 0 && !isIdle()) reloadBoth(); });
    onCatchup(() => { void pullIfStale(30_000); void reloadItems(); });

    let hiddenAt = 0;
    let idleAtHide = false;

    document.addEventListener('visibilitychange', async () => {
      if (document.visibilityState === 'hidden') {
        hiddenAt = Date.now();
        idleAtHide = isIdle();
        clearActivityOnHide();
      } else if (document.visibilityState === 'visible') {
        const away = Date.now() - hiddenAt;
        if (away > 5 * 60_000) {
          await reloadFeeds();
          await reloadItems();
          if (!idleAtHide) {
            await pullIfStale(30_000);
          }
        }
      }
    }, { once: false });

    window.addEventListener('online', () => { void pullIfStale(120_000); });

    await bootSync();
    const params = new URLSearchParams(window.location.search);
    const pairCode = params.get('pair');
    if (pairCode) {
      let success = false;
      let message = '';
      try {
        const key = await redeemCode(pairCode);
        await setStoredSyncKey(key);
        await updateSettingsWith({ syncKey: key });
        await triggerFirstTime();
        success = true;
        message = 'Paired successfully';
      } catch (e) {
        message = e instanceof Error ? e.message : 'Pairing failed';
      }
      await reloadFeeds();
      await reloadItems();
      history.replaceState(null, '', window.location.pathname);
      openModal({ kind: 'pair-result', success, message });
    }

    // Agent intent: ?intent=add&url=<feed-url> opens the add-feed modal
    // prefilled. The value is passed through unvalidated — discovery-time
    // validation gates it; nothing is fetched as a side effect of loading.
    const intent = params.get('intent');
    if (intent === 'add') {
      openModal({ kind: 'add-feed', url: params.get('url') ?? undefined });
      history.replaceState(null, '', window.location.pathname);
    }
  })().finally(() => setHydrated(true));

  return <Ctx.Provider value={value}>{props.children}</Ctx.Provider>;
};

export function applyTheme(theme: ThemePreference, highContrast: boolean): void {
  const root = document.documentElement;
  root.removeAttribute('data-theme');
  root.removeAttribute('data-a11y');
  if (highContrast) {
    root.setAttribute('data-a11y', 'true');
  }
  if (theme === 'light') {
    root.setAttribute('data-theme', 'light');
  } else if (theme === 'dark') {
    root.setAttribute('data-theme', 'dark');
  }
}
