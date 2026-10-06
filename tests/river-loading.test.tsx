// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { createSignal, createMemo, createRoot } from 'solid-js';
import { createStore } from 'solid-js/store';
import { render } from 'solid-js/web';
import { River } from '../src/components/River';
import type { AppContext, AppState } from '../src/state';
import type { Feed, Item } from '../src/db/types';

const ctxRef = vi.hoisted(() => ({ value: null as AppContext | null }));

const dbBlock = vi.hoisted(() => ({ status: 'idle' as 'idle' | 'blocked' | 'upgrading', listeners: new Set<() => void>() }));

vi.mock('../src/db/open', () => ({
  getDbStatus: () => dbBlock.status,
  onDbStatusChange: (listener: () => void) => {
    dbBlock.listeners.add(listener);
    return () => dbBlock.listeners.delete(listener);
  },
}));

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
    articleListWidth: 720,
    articleListWidthCustomized: true,
    focusMode: false,
    focusedIndex: -1,
    starredOnly: false,
    readMode: 'all',
    modal: { kind: 'none' },
    returnToItemId: null,
  });
  const [feeds, setFeeds] = createSignal<Feed[]>([]);
  const [items, setItems] = createSignal<Item[]>([]);
  const [hydrated, setHydrated] = createSignal(false);
  const feedMap = createMemo(() => new Map(feeds().map((f) => [f.id, f])));

  const ctx: AppContext = {
    hasScopedItems: () => false,
    setReadMode: async () => {},
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
    statsRevision: () => 0,
    openStats: () => {},
  };

  return { ctx, setFeeds, setItems, setHydrated };
}

function setDbStatus(status: 'idle' | 'blocked' | 'upgrading'): void {
  dbBlock.status = status;
  dbBlock.listeners.forEach((listener) => listener());
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
    dbBlock.status = 'idle';
    vi.useRealTimers();
  });

  it('shows the upgrade message while the library is upgrading, then reverts', () => {
    const m = createRoot((d) => {
      disposeCtx = d;
      return makeCtx();
    });
    ctxRef.value = m.ctx;
    dispose = render(() => <River />, document.body);
    vi.advanceTimersByTime(600);
    expect(document.body.textContent).toContain('Loading…');

    setDbStatus('upgrading');
    expect(document.body.textContent).toContain('Updating your library…');
    expect(document.body.textContent).not.toContain('Loading…');

    setDbStatus('idle');
    expect(document.body.textContent).toContain('Loading…');
    expect(document.body.textContent).not.toContain('Updating your library');
  });

  it('asks the reader to close other tabs while the open is blocked, in place of the upgrade message', () => {
    const m = createRoot((d) => {
      disposeCtx = d;
      return makeCtx();
    });
    ctxRef.value = m.ctx;
    dispose = render(() => <River />, document.body);
    vi.advanceTimersByTime(600);

    setDbStatus('blocked');
    expect(document.body.textContent).toContain('Close other Sift tabs');
    expect(document.body.textContent).not.toContain('Updating your library');

    setDbStatus('upgrading');
    expect(document.body.textContent).toContain('Updating your library…');
    expect(document.body.textContent).not.toContain('Close other Sift tabs');
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
  it.each([
    { stored: true, failed: false, message: 'You’re caught up' },
    { stored: false, failed: false, message: 'No items yet' },
    { stored: true, failed: true, message: 'No items yet' },
  ])('distinguishes caught-up, empty and failed scopes: $message', ({ stored, failed, message }) => {
    const m = createRoot((d) => { disposeCtx = d; return makeCtx(); });
    m.ctx.setState({ readMode: 'unread' });
    m.ctx.hasScopedItems = () => stored;
    m.ctx.feedErrors = (): Record<string, string> => failed ? { f1: 'Refresh failed' } : {};
    m.setFeeds([{ id: 'f1', title: 'Example', tags: ['news'] } as Feed]);
    m.setHydrated(true);
    ctxRef.value = m.ctx;
    dispose = render(() => <River />, document.body);
    expect(document.body.textContent).toContain(message);
    if (message === 'You’re caught up') {
      const changeMode = vi.fn(async () => {});
      m.ctx.setReadMode = changeMode;
      document.querySelector<HTMLButtonElement>('.empty-state button')?.click();
      expect(changeMode).toHaveBeenCalledWith('all');
    } else expect(document.body.textContent).not.toContain('You’re caught up');
  });

  it('shows fetching feedback instead of caught up while a scoped feed loads', () => {
    const m = createRoot((d) => { disposeCtx = d; return makeCtx(); });
    m.ctx.setState({ readMode: 'unread', activeTags: ['news'] });
    m.ctx.hasScopedItems = () => true;
    m.ctx.fetchingFeeds = () => new Set(['f1']);
    m.setFeeds([{ id: 'f1', title: 'Example', tags: ['news'] } as Feed]);
    m.setHydrated(true);
    ctxRef.value = m.ctx;
    dispose = render(() => <River />, document.body);
    vi.advanceTimersByTime(600);
    expect(document.body.textContent).toContain('Fetching your feeds');
    expect(document.body.textContent).not.toContain('You’re caught up');
  });

});
