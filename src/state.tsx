import { createSignal, createMemo, createContext, useContext } from 'solid-js';
import type { ParentComponent } from 'solid-js';
import { createStore } from 'solid-js/store';
import { listFeeds } from './db/feeds';
import { listItems, listItemsByFeed, markRead, toggleStar as dbToggleStar } from './db/items';
import type { Feed, Item } from './db/types';
import { itemUrl, parseItemIdFromUrl, hashId } from './routing';
import { getSettings, saveSettings, type AppSettings, type ThemePreference } from './settings';
import { refreshStaleFeeds, fetchingState, startScheduler } from './feeds/scheduler';
import { enqueueFlag } from './sync/queue';
import { scheduleFlush } from './sync/push';
import { bootSync, pullIfStale, pullNow, triggerFirstTime } from './sync/init';
import { getStoredSyncKey, isValidSyncKey, generateSyncKey, setStoredSyncKey } from './sync/key';
import { redeemCode } from './sync/client';
import { subscribeFeed as subscribeFeedSvc, unsubscribeFeed as unsubscribeFeedSvc, type SubscribeInput } from './feeds/service';

type ViewKind = 'river' | 'reading';
type ModalKind =
  | { kind: 'none' }
  | { kind: 'palette' }
  | { kind: 'shortcuts' }
  | { kind: 'settings' }
  | { kind: 'add-feed' }
  | { kind: 'confirm-unsubscribe'; feedUrl: string; feedTitle: string }
  ;

export interface AppState {
  view: ViewKind;
  /** The feed URL the river is currently scoped to; null = All. */
  riverScope: string | null;
  /** "current" item being viewed in the reading view; null when in river. */
  currentItem: Item | null;
  sidebarOpen: boolean;        // mobile drawer state
  sidebarHiddenDesktop: boolean; // Cmd+\ toggle on desktop
  focusedIndex: number;       // keyboard focus in the river
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
  settings: () => AppSettings;
  fetching: () => number;
  feedErrors: () => Record<string, string>;
  fetchingFeeds: () => Set<string>;
  reloadFeeds: () => Promise<Feed[]>;
  reloadItems: () => Promise<void>;
  setRiverScope: (feedUrl: string | null) => void;
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
  unsubscribeFeed: (feedUrl: string) => Promise<void>;
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
    currentItem: null,
    sidebarOpen: false,
    sidebarHiddenDesktop: false,
    focusedIndex: 0,
    modal: { kind: 'none' },
    returnToItemId: null,
  });

  const setState = (patch: Partial<AppState>) => setStateInternal(patch as Partial<AppState>);

  const [feeds, setFeeds] = createSignal<Feed[]>([]);
  const feedMap = createMemo(() => new Map(feeds().map((f) => [f.url, f])));
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
        await unsubscribeFeedCtx(data.url);
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
      feedUrl: item.feedUrl,
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
      feedUrl: item.feedUrl,
      read: item.read ? 1 : 0,
      readAt: now,
      starred: !item.starred ? 1 : 0,
      starredAt: now,
    });
    scheduleFlush();
  };

  const reloadFeeds = async () => setFeeds(await listFeeds());
  const reloadItems = async () => {
    if (state.riverScope != null) {
      setItems(await listItemsByFeed(state.riverScope, 500));
    } else {
      setItems(await listItems(500));
    }
  };

  const setRiverScope = (feedUrl: string | null) => {
    setState({ riverScope: feedUrl, focusedIndex: 0, view: 'river' });
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
    try {
      await reloadItems();
    } catch {
      // reload failure is non-fatal; still switch back to river
    }
    setState({ view: 'river', currentItem: null });
    history.replaceState(null, '', '/');
  };

  const toggleSidebar = () => setState({ sidebarOpen: !state.sidebarOpen, sidebarHiddenDesktop: false });
  const toggleSidebarDesktop = () =>
    setState({ sidebarHiddenDesktop: !state.sidebarHiddenDesktop });

  const openModal = (modal: ModalKind) => setState({ modal });
  const closeModal = () => setState({ modal: { kind: 'none' } });

  const jumpTo = (offset: number) => {
    const list = items();
    if (list.length === 0) return;
    const next = Math.max(0, Math.min(list.length - 1, state.focusedIndex + offset));
    setState({ focusedIndex: next });
  };

  const refreshAll = async () => {
    await refreshStaleFeeds(true);
    await reloadFeeds();
    await reloadItems();
  };

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
      await triggerFirstTime();
    } catch (e) {
      await disableSync();
      throw e;
    }
  };

  const disableSync = async () => {
    await updateSettingsWith({ syncKey: null, lastSyncAt: null });
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

  const unsubscribeFeedCtx = async (feedUrl: string) => {
    await unsubscribeFeedSvc(feedUrl);
    if (state.riverScope === feedUrl) {
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
    settings,
    fetching: fetchingState.inFlight,
    feedErrors: fetchingState.feedErrors,
    fetchingFeeds: fetchingState.fetchingFeeds,
    reloadFeeds,
    reloadItems,
    setRiverScope,
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
    // Restore last sidebar selection from persisted setting, falling
    // back to all-feeds view if the saved feed no longer exists.
    const validFeed =
      s.lastFeedUrl && feeds().some((f) => f.url === s.lastFeedUrl)
        ? s.lastFeedUrl
        : null;
    setState({ riverScope: validFeed });
    await reloadItems();
    // If the URL references a specific article, restore it.
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
    // After the first refresh sweep, keep feeds/items in sync.
    setInterval(async () => {
      if (document.visibilityState === 'hidden') return;
      await reloadFeeds();
      await reloadItems();
    }, 30_000);
    // Refresh immediately on tab return.
    document.addEventListener('visibilitychange', async () => {
      if (document.visibilityState === 'visible') {
        await reloadFeeds();
        await reloadItems();
        await pullIfStale(30_000);
      }
    }, { once: false });
    // Online event → pull.
    window.addEventListener('online', () => { void pullNow(); });
    // Boot sync: pull / first-time setup.
    await bootSync();
    // QR auto-pairing: redeem ?pair= code on boot.
    const params = new URLSearchParams(window.location.search);
    const pairCode = params.get('pair');
    if (pairCode) {
      try {
        const key = await redeemCode(pairCode);
        await setStoredSyncKey(key);
        await updateSettingsWith({ syncKey: key });
        await triggerFirstTime();
      } catch (e) {
        console.error('QR pairing failed:', e);
      }
      await reloadFeeds();
      await reloadItems();
      history.replaceState(null, '', window.location.pathname);
    }
  })();

  return <Ctx.Provider value={value}>{props.children}</Ctx.Provider>;
};

/**
 * Apply the theme and high-contrast mode by setting `data-theme` and
 * `data-a11y` on <html>. When the preference is `system`, we leave
 * `data-theme` unset and let the `@media (prefers-color-scheme: dark)`
 * rule do the work.
 */
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