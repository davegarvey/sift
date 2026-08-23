import { For } from 'solid-js';

const SECTIONS: { title: string; shortcuts: { keys: string[]; label: string }[] }[] = [
  {
    title: 'List',
    shortcuts: [
      { keys: ['j'], label: 'Next item' },
      { keys: ['k'], label: 'Previous item' },
      { keys: ['Enter'], label: 'Open focused item' },
      { keys: ['/'], label: 'Search' },
      { keys: ['r'], label: 'Refresh current selection' },
      { keys: ['⌘K'], label: 'Command palette' },
      { keys: ['⌘\\'], label: 'Toggle sidebar' },
    ],
  },
  {
    title: 'Reading',
    shortcuts: [
      { keys: ['j'], label: 'Next item' },
      { keys: ['k'], label: 'Previous item' },
      { keys: ['s'], label: 'Toggle star' },
      { keys: ['o'], label: 'Open original' },
      { keys: ['r'], label: 'Refresh current selection' },
      { keys: ['Esc'], label: 'Back to list' },
    ],
  },
  {
    title: 'General',
    shortcuts: [
      { keys: ['?'], label: 'This overlay' },
    ],
  },
];

export function ShortcutsOverlay() {
  return (
    <div class="modal shortcuts-list">
      <div class="modal-header">Keyboard shortcuts</div>
      <div class="modal-body" style={{ padding: '8px 0' }}>
        <For each={SECTIONS}>
          {(section) => (
            <>
              <div class="section-header">{section.title}</div>
              <For each={section.shortcuts}>
                {(row) => (
                  <div class="row">
                    <span>{row.label}</span>
                    <span class="keys">
                      <For each={row.keys}>{(k) => <kbd>{k}</kbd>}</For>
                    </span>
                  </div>
                )}
              </For>
            </>
          )}
        </For>
      </div>
    </div>
  );
}
