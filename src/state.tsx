import { createSignal, createContext, useContext } from 'solid-js';
import type { ParentComponent } from 'solid-js';
import { createStore } from 'solid-js/store';
import { listFeeds } from './db/feeds';
import { listItems, listItemsByFeed, markRead } from './db/items';
import type { Feed, Item } from './db/types';
import { getSettings, saveSettings, type AppSettings, type ThemePreference } from './settings';
import { refreshStaleFeeds, fetchingState, startScheduler } from './feeds/scheduler';

type ViewKind = 'river' | 'reading';
type ModalKind =
  | { kind: 'none' }
  | { kind: 'palette' }
  | { kind: 'shortcuts' }
  | { kind: 'settings' }
  | { kind: 'add-feed' }
  | { kind: 'confirm-unsubscribe'; feedUrl: string; feedTitle: string };

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
}

interface AppContext {
  state: AppState;
  setState: (patch: Partial<AppState>) => void;
  feeds: () => Feed[];
  items: () => Item[];
  settings: () => AppSettings;
  fetching: () => number;
  feedErrors: () => Record<string, string>;
  fetchingFeeds: () => Set<string>;
  reloadFeeds: () => Promise<Feed[]>;
  reloadItems: () => Promise<void>;
  setRiverScope: (feedUrl: string | null) => void;
  openItem: (item: Item) => Promise<void>;
  closeReading: () => void;
  toggleSidebar: () => void;
  toggleSidebarDesktop: () => void;
  openModal: (modal: ModalKind) => void;
  closeModal: () => void;
  jumpTo: (offset: number) => void;
  refreshAll: () => Promise<void>;
  toggleStar: (item: Item) => Promise<void>;
  saveSettingsPatch: (patch: Partial<AppSettings>) => Promise<void>;
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
  });

  const setState = (patch: Partial<AppState>) => setStateInternal(patch as Partial<AppState>);

  const [feeds, setFeeds] = createSignal<Feed[]>([]);
  const [items, setItems] = createSignal<Item[]>([]);
  const [settings, setSettings] = createSignal<AppSettings>({
    theme: 'system',
    lastRefreshRunAt: null,
    lastFeedUrl: null,
  });

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

  const openItem = async (item: Item) => {
    setState({ view: 'reading', currentItem: item, sidebarOpen: false });
    if (!item.read) {
      await markRead(item.id);
      // Optimistic: caller can reload items when needed.
    }
  };

  const closeReading = () => {
    setState({ view: 'river', currentItem: null });
    void reloadItems();
  };

  const toggleSidebar = () => setState({ sidebarOpen: !state.sidebarOpen });
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

  const toggleStar = async () => {
    // Forwarded by Reading view via the db mutation directly; this is just
    // a UI hook to refresh state after a star toggle.
    await reloadItems();
  };

  const saveSettingsPatch = async (patch: Partial<AppSettings>) => {
    const next = { ...settings(), ...patch };
    setSettings(next);
    await saveSettings(next);
  };

  const value: AppContext = {
    state,
    setState,
    feeds,
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
    toggleStar,
    saveSettingsPatch,
  };

  // Boot: load settings + initial feeds/items, then kick the scheduler.
  void (async () => {
    const s = await getSettings();
    setSettings(s);
    applyTheme(s.theme);
    await reloadFeeds();
    // Restore last sidebar selection from persisted setting, falling
    // back to all-feeds view if the saved feed no longer exists.
    const validFeed =
      s.lastFeedUrl && feeds().some((f) => f.url === s.lastFeedUrl)
        ? s.lastFeedUrl
        : null;
    setState({ riverScope: validFeed });
    await reloadItems();
    startScheduler();
    // After the first refresh sweep, keep feeds/items in sync.
    setInterval(async () => {
      await reloadFeeds();
      await reloadItems();
    }, 30_000);
  })();

  return <Ctx.Provider value={value}>{props.children}</Ctx.Provider>;
};

/**
 * Apply the theme by setting `data-theme` on <html>. When the preference
 * is `system`, we leave the attribute unset and let the `@media
 * (prefers-color-scheme: dark)` rule do the work.
 */
export function applyTheme(theme: ThemePreference): void {
  const root = document.documentElement;
  root.removeAttribute('data-theme');
  root.removeAttribute('data-a11y');
  if (theme === 'light') {
    root.setAttribute('data-theme', 'light');
  } else if (theme === 'dark') {
    root.setAttribute('data-theme', 'dark');
  } else if (theme === 'accessible') {
    root.setAttribute('data-a11y', 'true');
  }
}