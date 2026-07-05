import { ChevronLeft, PanelLeft } from 'lucide-solid';
import { useApp } from '../state';

export function TopBar() {
  const ctx = useApp();
  const open = () => ctx.state.sidebarOpen;

  return (
    <div class="topbar" aria-label="App chrome">
      <button
        class="pill sidebar-toggle"
        title={open() ? 'Close feeds' : 'Feeds'}
        aria-label={open() ? 'Close feeds sidebar' : 'Open feeds sidebar'}
        aria-expanded={open()}
        onClick={() => ctx.toggleSidebar()}
      >
        {open() ? <ChevronLeft size={18} /> : <PanelLeft size={18} />}
      </button>
      <span class="wordmark" aria-label="Sift">sift</span>
    </div>
  );
}
