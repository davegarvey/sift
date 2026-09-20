// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Item } from '../src/db/types';
import { hashId, itemIdFromHistoryState, itemUrl, writeItemHistory } from '../src/routing';
import { navigateReaderByOffset } from '../src/readerNavigation';

const first = { id: 'feed::first', title: 'First article' } as Item;
const second = { id: 'feed::second', title: 'Second article' } as Item;

describe('reader navigation history', () => {
  beforeEach(() => {
    window.history.replaceState(null, '', '/');
  });

  it('pushes a history entry when opening an article and replaces it for reader navigation', () => {
    writeItemHistory(first);
    expect(window.history.state).toEqual({ itemId: first.id });
    expect(window.location.pathname).toBe(itemUrl(first));

    writeItemHistory(second, true);
    expect(window.history.state).toEqual({ itemId: second.id });
    expect(window.location.pathname).toBe(itemUrl(second));
  });

  it('restores an item id only when the history entry matches the current URL hash', () => {
    expect(itemIdFromHistoryState({ itemId: first.id }, hashId(first.id))).toBe(first.id);
    expect(itemIdFromHistoryState({ itemId: first.id }, hashId(second.id))).toBeNull();
    expect(itemIdFromHistoryState(null, hashId(first.id))).toBeNull();
  });

  it('uses J/K offsets to replace the current article without pushing history', () => {
    const state = { focusedIndex: 0 };
    const jumpTo = vi.fn((offset: number) => { state.focusedIndex += offset; });
    const openItem = vi.fn(async () => {});
    const ctx = {
      state,
      items: () => [first, second],
      jumpTo,
      openItem,
    };

    navigateReaderByOffset(ctx, 1);
    expect(jumpTo).toHaveBeenCalledWith(1);
    expect(openItem).toHaveBeenCalledWith(second, true);

    navigateReaderByOffset(ctx, -1);
    expect(openItem).toHaveBeenLastCalledWith(first, true);
  });

  it('keeps the current item when an offset is clamped at a list boundary', () => {
    const openItem = vi.fn(async () => {});
    const state = { focusedIndex: 0 };
    navigateReaderByOffset({
      state,
      items: () => [first],
      jumpTo: () => { state.focusedIndex = 0; },
      openItem,
    }, 1);
    expect(openItem).toHaveBeenCalledWith(first, true);
  });
});
