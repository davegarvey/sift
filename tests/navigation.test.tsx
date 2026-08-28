import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createMemo, createSignal } from 'solid-js';
import { createStore } from 'solid-js/store';
import { render } from 'solid-js/web';
import { Sidebar } from '../src/components/Sidebar';
import type { AppContext, AppState } from '../src/state';
import type { Feed } from '../src/db/types';

const contextRef = vi.hoisted(() => ({ value: null as AppContext | null }));

vi.mock('../src/state', () => ({
  useApp: () => {
    if (!contextRef.value) throw new Error('test context not set');
    return contextRef.value;
  },
}));

function makeContext(collapsed = false) {
  const [state] = createStore<AppState>({
    view: 'river',
    riverScope: null,
    activeTags: [],
    currentItem: null,
    sidebarOpen: false,
    sidebarHiddenDesktop: collapsed,
    focusedIndex: -1,
    starredOnly: false,
    modal: { kind: 'none' },
    returnToItemId: null,
  });
  const [feeds] = createSignal<Feed[]>([]);
  const openStats = vi.fn();
  const ctx = {
    state,
    feeds,
    feedMap: createMemo(() => new Map()),
    allTags: () => [],
    activeTagSet: () => new Set<string>(),
    settings: () => ({ theme: 'system', highContrast: false, lastRefreshRunAt: null, lastFeedUrl: null, mcpEnabled: false }),
    fetching: () => 0,
    feedErrors: () => ({}),
    fetchingFeeds: () => new Set<string>(),
    hydrated: () => true,
    clearTags: vi.fn(),
    setRiverScope: vi.fn(),
    reloadItems: async () => {},
    saveSettingsPatch: async () => {},
    toggleStarFilter: vi.fn(),
    refreshSelected: async () => {},
    openModal: vi.fn(),
    toggleSidebarDesktop: vi.fn(),
    openStats,
  } as unknown as AppContext;
  return { ctx, openStats };
}

describe('stats navigation', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    contextRef.value = null;
  });

  it('exposes Stats as a labeled bottom-sidebar CTA', () => {
    const { ctx, openStats } = makeContext();
    contextRef.value = ctx;
    const dispose = render(() => <Sidebar />, document.body);
    const button = [...document.querySelectorAll<HTMLButtonElement>('.sidebar-actions-bottom .sidebar-action')]
      .find((candidate) => candidate.textContent?.includes('Stats'));
    expect(button).toBeDefined();
    button?.click();
    expect(openStats).toHaveBeenCalledTimes(1);
    dispose();
  });

  it('keeps a Stats icon action in the collapsed rail', () => {
    const { ctx } = makeContext(true);
    contextRef.value = ctx;
    const dispose = render(() => <Sidebar />, document.body);
    const button = document.querySelector<HTMLButtonElement>('.collapsed-action[title="Reading statistics"]');
    expect(button).not.toBeNull();
    dispose();
  });
});
