// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { createSignal, createMemo, createRoot } from 'solid-js';
import { createStore } from 'solid-js/store';
import { render } from 'solid-js/web';
import { River } from '../src/components/River';
import type { AppContext, AppState } from '../src/state';
import type { Feed, Item } from '../src/db/types';

const ctxRef = vi.hoisted(() => ({ value: null as AppContext | null }));

vi.mock('../src/state', () => ({
  useApp: () => {
    if (!ctxRef.value) throw new Error('test ctx not set');
    return ctxRef.value;
  },
}));

if (!window.matchMedia) {
  window.matchMedia = (query: string) =>
    ({
      matches: false,
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    }) as MediaQueryList;
}

function makeCtx() {
  const [state, setState] = createStore<AppState>({
    view: 'river',
    riverScope: null,
    activeTags: [],
    currentItem: null,
    sidebarOpen: false,
    sidebarHiddenDesktop: false,
    focusedIndex: -1,
    starredOnly: false,
    modal: { kind: 'none' },
    returnToItemId: null,
  });
  const [feeds, setFeeds] = createSignal<Feed[]>([]);
  const [items, setItems] = createSignal<Item[]>([]);
  const [hydrated, setHydrated] = createSignal(false);
  const feedMap = createMemo(() => new Map(feeds().map((f) => [f.id, f])));

  const ctx: AppContext = {
    state,
    setState,
    feeds,
    items,
    hydrated,
    fetchingFeeds: () => new Set<string>(),
    fetching: () => 0,
    feedMap,
    allTags: () => [],
    activeTagSet: () => new Set<string>(),
    settings: () => ({
      theme: 'system',
      highContrast: false,
      lastRefreshRunAt: null,
      lastFeedUrl: null,
      mcpEnabled: false,
    }),
    feedErrors: () => ({}),
    reloadFeeds: async () => feeds(),
    reloadItems: async () => {},
    setRiverScope: () => {},
    toggleTag: () => {},
    clearTags: () => {},
    toggleStarFilter: () => {},
    openItem: async () => {},
    closeReading: async () => {},
    toggleSidebar: () => {},
    toggleSidebarDesktop: () => {},
    openModal: () => {},
    closeModal: () => {},
    jumpTo: () => {},
    refreshSelected: async () => {},
    refreshFeeds: async () => {},
    saveSettingsPatch: async () => {},
    mcpAvailable: () => false,
    mcpConnected: () => false,
    mcpNotifySync: async () => {},
    enableSync: async () => {},
    disableSync: async () => {},
    pairSyncWithKey: async () => {},
    regenerateSyncKey: async () => {},
    syncNow: async () => {},
    syncKey: () => null,
    subscribeFeed: async () => {},
    unsubscribeFeed: async () => {},
    updateFeedMeta: async () => {},
    changeFeedUrl: async () => {},
    updateFeedTags: async () => {},
    markReadAndSync: async () => {},
    toggleStar: async () => {},
  };

  return { ctx, setFeeds, setItems, setHydrated };
}

describe('River loading vs empty state', () => {
  let dispose: (() => void) | undefined;
  let disposeCtx: (() => void) | undefined;

  beforeEach(() => {
    vi.useFakeTimers();
    document.body.innerHTML = '';
  });

  afterEach(() => {
    dispose?.();
    dispose = undefined;
    disposeCtx?.();
    disposeCtx = undefined;
    ctxRef.value = null;
    vi.useRealTimers();
  });

  it('shows the Welcome empty state once boot completes with zero feeds', () => {
    const m = createRoot((d) => {
      disposeCtx = d;
      return makeCtx();
    });
    ctxRef.value = m.ctx;

    dispose = render(() => <River />, document.body);
    vi.advanceTimersByTime(600);
    expect(document.body.textContent).toContain('Loading');

    // Boot sequence order: lists reload (still empty, new refs), then hydrated flips.
    m.setFeeds([]);
    m.setItems([]);
    m.setHydrated(true);

    expect(document.body.textContent).toContain('Welcome to Sift');
    expect(document.body.textContent).not.toContain('Loading');
  });

  it('renders items once they load after boot', () => {
    const m = createRoot((d) => {
      disposeCtx = d;
      return makeCtx();
    });
    ctxRef.value = m.ctx;

    m.setFeeds([{ id: 'f1', url: 'https://example.com/feed', title: 'Example', tags: [] } as unknown as Feed]);
    m.setHydrated(true);

    dispose = render(() => <River />, document.body);

    m.setItems([
      { id: 'f1::a', feedId: 'f1', guid: 'a', title: 'First article', publishedAt: 1, read: false, starred: false } as unknown as Item,
    ]);

    expect(document.body.textContent).toContain('First article');
    expect(document.body.textContent).not.toContain('Loading');
    expect(document.body.textContent).not.toContain('Welcome to Sift');
  });

  it('shows the filtered empty state when feeds exist but no items match', () => {
    const m = createRoot((d) => {
      disposeCtx = d;
      return makeCtx();
    });
    ctxRef.value = m.ctx;

    m.setFeeds([{ id: 'f1', url: 'https://example.com/feed', title: 'Example', tags: ['news'] } as unknown as Feed]);
    m.setHydrated(true);
    m.setItems([]);

    dispose = render(() => <River />, document.body);
    vi.advanceTimersByTime(600);

    expect(document.body.textContent).toContain('No items yet');
    expect(document.body.textContent).not.toContain('Loading');
    expect(document.body.textContent).not.toContain('Welcome to Sift');
  });
});
