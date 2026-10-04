import { Show } from 'solid-js';
import { useApp } from '../state';

export function ReadFilter() {
  const ctx = useApp();
  return (
    <Show when={!ctx.state.starredOnly}>
      <div class="read-filter" role="group" aria-label="Article filter">
        <button type="button" aria-pressed={ctx.state.readMode === 'unread'} onClick={() => void ctx.setReadMode('unread')}>Unread</button>
        <button type="button" aria-pressed={ctx.state.readMode === 'all'} onClick={() => void ctx.setReadMode('all')}>All</button>
      </div>
    </Show>
  );
}
