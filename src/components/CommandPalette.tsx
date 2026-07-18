import { Search } from 'lucide-solid';
import { createSignal, For, Show, onMount, createMemo } from 'solid-js';
import { useApp } from '../state';
import { searchItems } from '../db/items';
import { refreshStaleFeeds } from '../feeds/scheduler';
import type { Item } from '../db/types';

const ACTIONS = [
  { id: 'add-feed', label: 'Add feed…' },
  { id: 'refresh-all', label: 'Refresh all' },
] as const;

export function CommandPalette() {
  const ctx = useApp();
  const [query, setQuery] = createSignal('');
  const [results, setResults] = createSignal<Item[]>([]);
  const [selected, setSelected] = createSignal(0);

  let inputRef: HTMLInputElement | undefined;
  let debounceTimer: ReturnType<typeof setTimeout> | null = null;
  let abortController: AbortController | null = null;
  let generation = 0;

  const update = () => {
    if (debounceTimer) clearTimeout(debounceTimer);
    const q = query().trim();
    if (q.length === 0) {
      if (abortController) abortController.abort();
      setResults([]);
      setSelected(0);
      return;
    }
    if (q.length < 2) {
      setResults([]);
      return;
    }
    debounceTimer = setTimeout(async () => {
      if (abortController) abortController.abort();
      abortController = new AbortController();
      const signal = abortController.signal;
      const myGen = ++generation;
      const items = await searchItems(q, 25, signal);
      if (myGen === generation) {
        setResults(items);
        setSelected(0);
      }
    }, 200);
  };

  const choose = (id: string) => {
    const item = results().find((i) => i.id === id);
    if (item) {
      void ctx.openItem(item);
      ctx.closeModal();
      return;
    }
    if (id === 'add-feed') {
      ctx.closeModal();
      ctx.openModal({ kind: 'add-feed' });
      return;
    }
    if (id === 'refresh-all') {
      ctx.closeModal();
      void ctx.refreshAll();
      return;
    }
  };

  onMount(() => {
    requestAnimationFrame(() => inputRef?.focus());
  });

  const rows = createMemo(() => {
    const label = query().trim().toLowerCase();
    return ACTIONS.filter((a) => label.length === 0 || a.label.toLowerCase().includes(label));
  });

  const totalRows = createMemo(() => results().length + rows().length);

  return (
    <div class="modal palette">
      <div class="palette-input">
        <Search size={14} />
        <input
          ref={inputRef}
          type="text"
          placeholder="Search items or run a command…"
          value={query()}
          onInput={(e) => {
            setQuery(e.currentTarget.value);
            void update();
          }}
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              ctx.closeModal();
            } else if (e.key === 'ArrowDown') {
              e.preventDefault();
              setSelected((s) => Math.min(totalRows() - 1, s + 1));
            } else if (e.key === 'ArrowUp') {
              e.preventDefault();
              setSelected((s) => Math.max(0, s - 1));
            } else if (e.key === 'Enter') {
              e.preventDefault();
              const r = results();
              const actions = rows();
              if (selected() < r.length) {
                choose(r[selected()].id);
              } else if (selected() - r.length < actions.length) {
                choose(actions[selected() - r.length].id);
              }
            }
          }}
        />
      </div>
      <div class="palette-results">
        <Show when={results().length > 0}>
          <div class="group-label">Items</div>
          <For each={results()}>
            {(item, idx) => (
              <div
                class={`row ${selected() === idx() ? 'selected' : ''}`}
                onMouseEnter={() => setSelected(idx())}
                onClick={() => choose(item.id)}
              >
                <div>
                  <div>{item.title}</div>
                  <div class="meta">
                    {ctx.feedMap().get(item.feedId)?.title ?? ''}
                  </div>
                </div>
              </div>
            )}
          </For>
        </Show>
        <Show when={rows().length > 0}>
          <div class="group-label">Actions</div>
          <For each={rows()}>
            {(action, idx) => (
              <div
                class={`row ${selected() === results().length + idx() ? 'selected' : ''}`}
                onMouseEnter={() => setSelected(results().length + idx())}
                onClick={() => choose(action.id)}
              >
                <span>{action.label}</span>
              </div>
            )}
          </For>
        </Show>
      </div>
    </div>
  );
}