import { useApp } from '../state';

export function TopBar() {
  const ctx = useApp();
  const refreshing = () => ctx.fetching() > 0;

  return (
    <div class="topbar" aria-label="App chrome">
      <button
        class="pill sidebar-toggle"
        title="Feeds"
        aria-label="Toggle feeds sidebar"
        aria-expanded={ctx.state.sidebarOpen}
        onClick={() => ctx.toggleSidebar()}
      >
        <MenuIcon />
      </button>
      <span class="wordmark" aria-label="Sift">sift</span>
      <span class="spacer" />
      <button
        class={`pill ${refreshing() ? 'refresh-spinning' : ''}`}
        title="Search / Command palette (⌘K)"
        onClick={() => ctx.openModal({ kind: 'palette' })}
      >
        <span>⌘K</span>
      </button>
      <button
        class="pill refresh-pill"
        title={refreshing() ? 'Refreshing…' : 'Refresh all feeds'}
        onClick={() => void ctx.refreshAll()}
        disabled={refreshing()}
        aria-label={refreshing() ? 'Refreshing feeds' : 'Refresh all feeds'}
      >
        <RefreshIcon spinning={refreshing()} />
      </button>
      <button
        class="pill"
        title="Settings"
        onClick={() => ctx.openModal({ kind: 'settings' })}
      >
        <SettingsIcon />
      </button>
    </div>
  );
}

function MenuIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
      <line x1="3" y1="6" x2="21" y2="6" />
      <line x1="3" y1="12" x2="21" y2="12" />
      <line x1="3" y1="18" x2="21" y2="18" />
    </svg>
  );
}

function SpinnerIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
      <path d="M21 12a9 9 0 1 1-6.2-8.55" />
    </svg>
  );
}

function RefreshIcon(props: { spinning: boolean }) {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="2"
      stroke-linecap="round"
      stroke-linejoin="round"
      class={props.spinning ? 'refresh-icon-spinning' : ''}
    >
      <path d="M23 4v6h-6" />
      <path d="M1 20v-6h6" />
      <path d="M3.5 9a9 9 0 0 1 14.5-3.5L23 10" />
      <path d="M20.5 15A9 9 0 0 1 6 18.5L1 14" />
    </svg>
  );
}

function SettingsIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </svg>
  );
}