// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createStore } from 'solid-js/store';
import { render } from 'solid-js/web';
import { ArticleListPane } from '../src/components/ArticleListPane';
import { FocusModeToggle } from '../src/components/FocusModeToggle';
import type { AppContext, AppState } from '../src/state';

const contextRef = vi.hoisted(() => ({ value: null as AppContext | null }));

vi.mock('../src/state', () => ({
  useApp: () => {
    if (!contextRef.value) throw new Error('test context not set');
    return contextRef.value;
  },
}));

vi.mock('../src/components/River', () => ({
  River: () => <main id="article-list" />,
}));

function makeContext() {
  const [state, setStore] = createStore<AppState>({
    view: 'reading',
    riverScope: null,
    activeTags: [],
    currentItem: null,
    sidebarOpen: false,
    sidebarHiddenDesktop: false,
    sidebarWidth: 240,
    articleListWidth: 640,
    articleListWidthCustomized: false,
    focusMode: false,
    focusedIndex: -1,
    starredOnly: false,
    modal: { kind: 'none' },
    returnToItemId: null,
  });
  const saveSettingsPatch = vi.fn(async () => {});
  const ctx = {
    state,
    setState: (patch: Partial<AppState>) => setStore(patch),
    saveSettingsPatch,
  } as unknown as AppContext;
  return { ctx, saveSettingsPatch };
}

function pointerEvent(type: string, clientX: number): Event {
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperties(event, {
    clientX: { value: clientX },
    pointerId: { value: 1 },
  });
  return event;
}

describe('article-list pane controls', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    contextRef.value = null;
  });

  it('resizes by pointer within bounds and persists the chosen width', () => {
    const { ctx, saveSettingsPatch } = makeContext();
    contextRef.value = ctx;
    const dispose = render(() => <ArticleListPane />, document.body);
    const resizer = document.querySelector<HTMLElement>('.article-list-resizer');
    expect(resizer?.getAttribute('aria-valuemin')).toBe('360');
    expect(resizer?.getAttribute('aria-valuemax')).toBe('720');

    resizer?.dispatchEvent(pointerEvent('pointerdown', 100));
    resizer?.dispatchEvent(pointerEvent('pointermove', -200));
    expect(ctx.state.articleListWidth).toBe(360);
    expect(ctx.state.articleListWidthCustomized).toBe(true);
    resizer?.dispatchEvent(pointerEvent('pointerup', -200));
    expect(saveSettingsPatch).toHaveBeenCalledWith({ articleListWidth: 360, articleListWidthCustomized: true });
    expect(ctx.state.sidebarWidth).toBe(240);

    resizer?.dispatchEvent(pointerEvent('pointerdown', 100));
    resizer?.dispatchEvent(pointerEvent('pointermove', 900));
    expect(ctx.state.articleListWidth).toBe(720);
    resizer?.dispatchEvent(pointerEvent('pointerup', 900));
    expect(ctx.state.sidebarWidth).toBe(240);
    dispose();
  });

  it('resizes by keyboard and saves each selected width', () => {
    const { ctx, saveSettingsPatch } = makeContext();
    contextRef.value = ctx;
    const dispose = render(() => <ArticleListPane />, document.body);
    const resizer = document.querySelector<HTMLElement>('.article-list-resizer');
    resizer?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Home', bubbles: true }));
    expect(ctx.state.articleListWidth).toBe(360);
    resizer?.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    expect(ctx.state.articleListWidth).toBe(368);
    expect(saveSettingsPatch).toHaveBeenNthCalledWith(1, { articleListWidth: 360, articleListWidthCustomized: true });
    expect(saveSettingsPatch).toHaveBeenNthCalledWith(2, { articleListWidth: 368, articleListWidthCustomized: true });
    dispose();
  });

  it('toggles and persists focus mode with the specified tooltip labels', () => {
    const { ctx, saveSettingsPatch } = makeContext();
    contextRef.value = ctx;
    const dispose = render(() => <FocusModeToggle />, document.body);
    const button = document.querySelector<HTMLButtonElement>('.focus-mode-toggle');
    expect(button?.title).toBe('Enable focus mode');
    button?.click();
    expect(ctx.state.focusMode).toBe(true);
    expect(button?.title).toBe('Disable focus mode');
    expect(button?.getAttribute('aria-pressed')).toBe('true');
    expect(saveSettingsPatch).toHaveBeenCalledWith({ focusMode: true });
    button?.click();
    expect(ctx.state.focusMode).toBe(false);
    expect(button?.title).toBe('Enable focus mode');
    expect(saveSettingsPatch).toHaveBeenLastCalledWith({ focusMode: false });
    dispose();
  });
});
