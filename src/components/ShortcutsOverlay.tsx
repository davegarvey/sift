import { For } from 'solid-js';

const SHORTCUTS: { keys: string[]; label: string }[] = [
  { keys: ['j'], label: 'Next item' },
  { keys: ['k'], label: 'Previous item' },
  { keys: ['Enter'], label: 'Open focused item' },
  { keys: ['Esc'], label: 'Back to river' },
  { keys: ['o'], label: 'Open original' },
  { keys: ['s'], label: 'Toggle star' },
  { keys: ['r'], label: 'Refresh all' },
  { keys: ['/'], label: 'Search' },
  { keys: ['⌘K'], label: 'Command palette' },
  { keys: ['?'], label: 'This overlay' },
  { keys: ['⌘\\'], label: 'Toggle sidebar' },
];

export function ShortcutsOverlay() {
  return (
    <div class="modal shortcuts-list">
      <div class="modal-header">Keyboard shortcuts</div>
      <div class="modal-body" style={{ padding: '8px 0' }}>
        <For each={SHORTCUTS}>
          {(row) => (
            <div class="row">
              <span>{row.label}</span>
              <span class="keys">
                <For each={row.keys}>{(k) => <kbd>{k}</kbd>}</For>
              </span>
            </div>
          )}
        </For>
      </div>
    </div>
  );
}