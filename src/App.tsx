import { onMount, onCleanup, Show, type JSX } from 'solid-js';
import { AppProvider, useApp } from './state';
import { hashId, parseItemIdFromUrl } from './routing';
import { TopBar } from './components/TopBar';
import { Sidebar } from './components/Sidebar';
import { River } from './components/River';
import { ReadingView } from './components/ReadingView';
import { CommandPalette } from './components/CommandPalette';
import { AddFeedModal } from './components/AddFeedModal';
import { SettingsDrawer } from './components/SettingsDrawer';
import { ShortcutsOverlay } from './components/ShortcutsOverlay';
import { ConfirmUnsubscribeModal } from './components/ConfirmUnsubscribeModal';
import './styles.css';

function Shell() {
  const ctx = useApp();

  const nav = (e: KeyboardEvent) => {
    // Don't intercept typing into inputs/textareas.
    const target = e.target as HTMLElement | null;
    if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) {
      if (e.key === 'Escape' && ctx.state.modal.kind !== 'none') ctx.closeModal();
      return;
    }
    if (ctx.state.modal.kind !== 'none') {
      if (e.key === 'Escape') ctx.closeModal();
      return;
    }
    if (ctx.state.view === 'reading') {
      if (e.key === 'Escape') {
        e.preventDefault();
        ctx.closeReading();
      } else if (e.key === 's') {
        e.preventDefault();
        // Toggle the current item's star by clicking the star button.
        const btn = document.querySelector<HTMLButtonElement>('.reading-chrome .star');
        btn?.click();
      } else if (e.key === 'r') {
        e.preventDefault();
        void ctx.refreshAll();
      } else if (e.key === 'j') {
        e.preventDefault();
        ctx.jumpTo(1);
        const items = ctx.items();
        const item = items[ctx.state.focusedIndex];
        if (item) void ctx.openItem(item, true);
      } else if (e.key === 'k') {
        e.preventDefault();
        ctx.jumpTo(-1);
        const items = ctx.items();
        const item = items[ctx.state.focusedIndex];
        if (item) void ctx.openItem(item, true);
      } else if (e.key === 'o') {
        e.preventDefault();
        const item = ctx.state.currentItem;
        if (item?.link) window.open(item.link, '_blank', 'noopener,noreferrer');
      } else if (e.key === '?') {
        e.preventDefault();
        ctx.openModal({ kind: 'shortcuts' });
      }
      return;
    }
    if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
      e.preventDefault();
      ctx.openModal({ kind: 'palette' });
      return;
    }
    if (e.key === '/' ) {
      e.preventDefault();
      ctx.openModal({ kind: 'palette' });
      return;
    }
    if (e.key === 'r') {
      e.preventDefault();
      void ctx.refreshAll();
      return;
    }
    if (e.key === '?' || (e.shiftKey && e.key === '/')) {
      if (e.key === '?') {
        e.preventDefault();
        ctx.openModal({ kind: 'shortcuts' });
      }
      return;
    }
    if ((e.metaKey || e.ctrlKey) && e.key === '\\') {
      e.preventDefault();
      ctx.toggleSidebarDesktop();
      return;
    }
    if (e.key === 'j') {
      e.preventDefault();
      ctx.jumpTo(1);
    } else if (e.key === 'k') {
      e.preventDefault();
      ctx.jumpTo(-1);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const items = ctx.items();
      const item = items[ctx.state.focusedIndex];
      if (item) void ctx.openItem(item);
    }
  };

  const onKey = (e: KeyboardEvent) => nav(e);
  const onPop = () => {
    const path = window.location.pathname;
    if (path === '/') {
      if (ctx.state.view === 'reading') ctx.closeReading();
    } else {
      const hash = parseItemIdFromUrl();
      if (hash) {
        const item = ctx.items().find(i => hashId(i.id) === hash);
        if (item) ctx.openItem(item, true);
      }
    }
  };
  onMount(() => {
    window.addEventListener('keydown', onKey);
    window.addEventListener('popstate', onPop);

    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.addEventListener('controllerchange', () => {
        if (ctx.state.view === 'river') {
          window.location.reload();
        }
      });

      // Hourly SW update check — falls back to the browser's natural
      // navigation-triggered checks for long-running sessions.
      navigator.serviceWorker.ready.then((reg) => {
        const swUrl = reg.active?.scriptURL ?? '/sw.js';
        const swInterval = setInterval(async () => {
          if (reg.installing || !navigator.onLine) return;
          const resp = await fetch(swUrl, {
            cache: 'no-store',
            headers: { 'cache-control': 'no-cache' },
          });
          if (resp.ok) await reg.update();
        }, 3_600_000);
        onCleanup(() => clearInterval(swInterval));
      });
    }
  });
  onCleanup(() => {
    window.removeEventListener('keydown', onKey);
    window.removeEventListener('popstate', onPop);
  });

  const reading = () => ctx.state.view === 'reading';
  const sidebarHiddenAttr = () => String(ctx.state.sidebarHiddenDesktop && !reading());
  const sidebarOpenAttr = () => String(ctx.state.sidebarOpen);

  return (
    <div
      class="app-shell"
      data-reading={String(reading())}
      data-sidebar-hidden={sidebarHiddenAttr()}
      data-sidebar-open={sidebarOpenAttr()}
    >
      <TopBar />
      <Show when={!reading()}>
        <Sidebar onNavigate={() => ctx.setState({ sidebarOpen: false })} />
        <div
          class="sidebar-backdrop"
          onClick={() => ctx.setState({ sidebarOpen: false })}
        />
        <River />
      </Show>
      <Show when={reading()}>
        <ReadingView />
      </Show>

      <Show when={ctx.state.modal.kind === 'palette'}>
        <Backdrop><CommandPalette /></Backdrop>
      </Show>
      <Show when={ctx.state.modal.kind === 'add-feed'}>
        <Backdrop><AddFeedModal /></Backdrop>
      </Show>
      <Show when={ctx.state.modal.kind === 'settings'}>
        <Backdrop><SettingsDrawer /></Backdrop>
      </Show>
      <Show when={ctx.state.modal.kind === 'shortcuts'}>
        <Backdrop><ShortcutsOverlay /></Backdrop>
      </Show>
      <Show when={ctx.state.modal.kind === 'confirm-unsubscribe'}>
        <Backdrop><ConfirmUnsubscribeModal /></Backdrop>
      </Show>
    </div>
  );
}

function Backdrop(props: { children: JSX.Element }) {
  const ctx = useApp();
  return (
    <div
      class="modal-backdrop"
      onClick={(e) => {
        if (e.target === e.currentTarget) ctx.closeModal();
      }}
    >
      {props.children}
    </div>
  );
}

export function App() {
  return (
    <AppProvider>
      <Shell />
    </AppProvider>
  );
}