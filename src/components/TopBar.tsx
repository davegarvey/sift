import { PanelLeft } from 'lucide-solid';
import { useApp } from '../state';

export function TopBar() {
  const ctx = useApp();

  return (
    <div class="topbar" aria-label="App chrome">
      <button
        class="pill sidebar-toggle"
        title="Feeds"
        aria-label="Toggle feeds sidebar"
        aria-expanded={ctx.state.sidebarOpen}
        onClick={() => ctx.toggleSidebar()}
      >
        <PanelLeft size={18} />
      </button>
      <span class="wordmark" aria-label="Sift">sift</span>
    </div>
  );
}
