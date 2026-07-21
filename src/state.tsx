import { createSignal, createMemo, createContext, useContext } from 'solid-js';
import type { ParentComponent } from 'solid-js';
import { createStore } from 'solid-js/store';
import { listFeeds } from './db/feeds';
import { listItems, listItemsByFeed, markRead, toggleStar as dbToggleStar } from './db/items';
import type { Feed, Item } from './db/types';
import { itemUrl, parseItemIdFromUrl, hashId } from './routing';
import { getMeta, setMeta } from './db/meta';
import { DEFAULT_SETTINGS } from './db/types';
import type { AppSettings, ThemePreference } from './db/types';

const SETTINGS_KEY = 'settings';

async function getSettings(): Promise<AppSettings> {
  const stored = await getMeta<Partial<AppSettings>>(SETTINGS_KEY, {});
  return { ...DEFAULT_SETTINGS, ...stored };
}

async function saveSettings(settings: AppSettings): Promise<void> {
  await setMeta(SETTINGS_KEY, settings);
}
import { refreshStaleFeeds, fetchingState, startScheduler, setOnRefresh } from './feeds/scheduler';
import { enqueueFlag } from './sync/queue';
import { scheduleFlush } from './sync/push';
import { bootSync, pullIfStale, pullNow, triggerFirstTime } from './sync/init';
import { setOnSync } from './sync/merge';
import { getStoredSyncKey, isValidSyncKey, generateSyncKey, setStoredSyncKey } from './sync/key';
import { redeemCode, register } from './sync/client';
import { subscribeFeed as subscribeFeedSvc, unsubscribeFeed as unsubscribeFeedSvc, updateFeedMeta, changeFeedUrl, type SubscribeInput } from './feeds/service';
import { isIdle, onCatchup, clearActivityOnHide } from './util/idle';

type ViewKind = 'river' | 'reading';
type ModalKind =
  | { kind: 'none' }
  | { kind: 'palette' }
  | { kind: 'shortcuts' }
  | { kind: 'settings' }
  | { kind: 'add-feed' }
  | { kind: 'feed-editor'; feedId: string }
  | { kind: 'confirm-unsubscribe'; feedId: string }
  | { kind: 'pair-result'; success: boolean; message: string }
  | { kind: 'sync-join' }
  | { kind: 'sync-share' }
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
  focusedIndex: number;
  modal: ModalKind;
  /** Item ID to restore focus to when returning to the river. */
  returnToItemId: string | null;
}

interface AppContext {
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
  reloadFeeds: () => Promise<Feed[]>;
  reloadItems: () => Promise<void>;
  setRiverScope: (feedId: string | null) => void;
  toggleTag: (tag: string) => void;
  clearTags: () => void;
  openItem: (item: Item, replace?: boolean) => Promise<void>;
  closeReading: () => Promise<void>;
  toggleSidebar: () => void;
  toggleSidebarDesktop: () => void;
  openModal: (modal: ModalKind) => void;
  closeModal: () => void;
  jumpTo: (offset: number) => void;
  refreshAll: () => Promise<void>;
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
}

const Ctx = createContext<AppContext>();

export const useApp = (): AppContext => {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useApp must be used within AppProvider');
  return ctx;
};

export const AppProvider: ParentComponent = (props) => {
  const [state, setStateInternal] = createStore<AppState>({
    view: 'river',
    riverScope: null,
    activeTags: [],
    currentItem: null,
    sidebarOpen: false,
    sidebarHiddenDesktop: false,
    focusedIndex: 0,
    modal: { kind: 'none' },
    returnToItemId: null,
  });

  const setState = (patch: Partial<AppState>) => setStateInternal(patch as Partial<AppState>);

  const [feeds, setFeeds] = createSignal<Feed[]>([]);
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
  const [settings, setSettings] = createSignal<AppSettings>({
    theme: 'system',
    highContrast: false,
    lastRefreshRunAt: null,
    lastFeedUrl: null,
    mcpEnabled: false,
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
    const now = Date.now();
    enqueueFlag({
      itemId: item.id,
      feedId: item.feedId,
      read: read ? 1 : 0,
      readAt: now,
      starred: item.starred ? 1 : 0,
      starredAt: now,
    });
    scheduleFlush();
  };

  const toggleStarAndSync = async (item: Item) => {
    await dbToggleStar(item.id);
    const now = Date.now();
    enqueueFlag({
      itemId: item.id,
      feedId: item.feedId,
      read: item.read ? 1 : 0,
      readAt: now,
      starred: !item.starred ? 1 : 0,
      starredAt: now,
    });
    scheduleFlush();
  };

  const reloadFeeds = async () => setFeeds(await listFeeds());

  let reloadingItems = false;
  const reloadItems = async () => {
    if (reloadingItems) return;
    reloadingItems = true;
    try {
      if (state.riverScope != null) {
        setItems(await listItemsByFeed(state.riverScope, 500));
      } else {
        setItems(await listItems(500));
      }
    } finally {
      reloadingItems = false;
    }
  };

  const setRiverScope = (feedId: string | null) => {
    setState({ riverScope: feedId, activeTags: [], focusedIndex: 0, view: 'river' });
  };

  const toggleTag = (tag: string) => {
    const current = state.activeTags;
    const idx = current.indexOf(tag);
    if (idx >= 0) {
      const next = current.filter((t) => t !== tag);
      setState({ activeTags: next, riverScope: null, focusedIndex: 0 });
      if (next.length > 0) void reloadItems();
    } else {
      setState({ activeTags: [...current, tag], riverScope: null, focusedIndex: 0 });
      void reloadItems();
    }
  };

  const clearTags = () => {
    if (state.activeTags.length === 0) return;
    setState({ activeTags: [], focusedIndex: 0 });
    void reloadItems();
  };

  const openItem = async (item: Item, replace = false) => {
    setState({ view: 'reading', currentItem: item, sidebarOpen: false, returnToItemId: item.id });
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

  const refreshAll = async () => {
    fetchingState.setInFlight(n => n + 1);
    try {
      try {
        await pullNow();
      } catch {
        // Sync server unreachable — continue with local feeds only.
      }
      await refreshStaleFeeds(true);
    } finally {
      fetchingState.setInFlight(n => Math.max(0, n - 1));
    }
    await reloadFeeds();
    await reloadItems();
  };

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
      // Register the sync key on the server before any push attempt.
      // pushChunk also auto-registers on 401, but an explicit register
      // here avoids a 401 -> retry cycle on a fresh D1.
      await register();
      await triggerFirstTime();
    } catch (e) {
      await disableSync();
      throw e;
    }
  };

  const disableSync = async () => {
    await updateSettingsWith({ syncKey: null });
  };

  const pairSyncWithKey = async (key: string) => {
    if (!isValidSyncKey(key)) {
      throw new Error('Invalid sync key format');
    }
    await setStoredSyncKey(key);
    await updateSettingsWith({ syncKey: key });
    try {
      await triggerFirstTime();
    } finally {
      await reloadFeeds();
      await reloadItems();
    }
  };

  const regenerateSyncKey = async () => {
    const newKey = generateSyncKey();
    await setStoredSyncKey(newKey);
    await updateSettingsWith({ syncKey: newKey });
  };

  const syncNow = async () => {
    await pullNow();
    await scheduleFlush();
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
    fetching: fetchingState.inFlight,
    feedErrors: fetchingState.feedErrors,
    fetchingFeeds: fetchingState.fetchingFeeds,
    reloadFeeds,
    reloadItems,
    setRiverScope,
    toggleTag,
    clearTags,
    openItem,
    closeReading,
    toggleSidebar,
    toggleSidebarDesktop,
    openModal,
    closeModal,
    jumpTo,
    refreshAll,
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
  };

  // Boot: load settings + initial feeds/items, then kick the scheduler.
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
    setState({ riverScope: validFeedId });
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
    setOnRefresh(reloadBoth);
    setOnSync(() => { if (!isIdle()) reloadBoth(); });
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
  })();

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
