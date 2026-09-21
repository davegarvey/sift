// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createStore } from 'solid-js/store';
import { render } from 'solid-js/web';
import { ReadingView } from '../src/components/ReadingView';
import type { AppContext, AppState } from '../src/state';

const contextRef = vi.hoisted(() => ({ value: null as AppContext | null }));

vi.mock('../src/state', () => ({
  useApp: () => {
    if (!contextRef.value) throw new Error('test context not set');
    return contextRef.value;
  },
}));

describe('reading view focus-mode navigation', () => {
  let dispose: (() => void) | undefined;
  let originalMatchMedia: typeof window.matchMedia | undefined;

  beforeEach(() => {
    document.body.innerHTML = '';
    originalMatchMedia = window.matchMedia;
    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      value: () => ({ matches: false }),
    });

    const [state, setStore] = createStore<AppState>({
      view: 'reading',
      riverScope: null,
      activeTags: [],
      currentItem: null,
      sidebarOpen: false,
      sidebarHiddenDesktop: false,
      articleListWidth: 432,
      articleListWidthCustomized: false,
      focusMode: true,
      focusedIndex: -1,
      starredOnly: false,
      modal: { kind: 'none' },
      returnToItemId: null,
    });
    const closeReading = vi.fn(async () => {});
    contextRef.value = {
      state,
      setState: (patch: Partial<AppState>) => setStore(patch),
      feeds: () => [],
      items: () => [],
      closeReading,
      saveSettingsPatch: vi.fn(async () => {}),
    } as unknown as AppContext;
    dispose = render(() => <ReadingView />, document.body);
  });

  afterEach(() => {
    dispose?.();
    contextRef.value = null;
    if (originalMatchMedia) {
      Object.defineProperty(window, 'matchMedia', { configurable: true, value: originalMatchMedia });
    } else {
      delete (window as Partial<Window>).matchMedia;
    }
  });

  it('shows a back action in focus mode that returns to the river', () => {
    const back = document.querySelector<HTMLButtonElement>('.reading-chrome .back');
    expect(back?.getAttribute('aria-label')).toBe('Back');
    expect(document.querySelector<HTMLButtonElement>('.focus-mode-toggle')?.title).toBe('Disable focus mode');

    back?.click();
    expect(contextRef.value?.closeReading).toHaveBeenCalledOnce();
    expect(contextRef.value?.state.focusMode).toBe(true);
  });
});
