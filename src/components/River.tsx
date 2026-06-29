import { For, Show, createMemo, createEffect } from 'solid-js';
import { useApp } from '../state';
import { markRead, toggleStar } from '../db/items';
import type { Item } from '../db/types';
import { relativeTime } from '../util/time';
import { Star } from 'lucide-solid';
import { CircleIcon, CircleCheckIcon } from './Icons';

export function River() {
  const ctx = useApp();
  let containerRef: HTMLDivElement | undefined;

  const visibleItems = createMemo(() => {
    const items = ctx.items();
    if (ctx.state.riverScope == null) return items;
    return items.filter((i) => i.feedUrl === ctx.state.riverScope);
  });

  // Auto navigation via state.focusedIndex and scroll into view on change.
  let lastFocusedEl: HTMLElement | null = null;
  let mouseNav = false;
  const onFocusChange = () => {
    const list = visibleItems();
    const idx = ctx.state.focusedIndex;
    if (idx < 0 || idx >= list.length) return;
    const els = containerRef?.querySelectorAll('[data-item-idx]') ?? [];
    const target = els[idx] as HTMLElement | undefined;
    if (target && target !== lastFocusedEl) {
      target.scrollIntoView({
        behavior: mouseNav ? 'auto' : 'smooth',
        block: mouseNav ? 'nearest' : 'center',
      });
      lastFocusedEl = target;
      mouseNav = false;
    }
  };

  createEffect(onFocusChange);

  // Render items swipe handler.
  const onStart = (e: PointerEvent, item: Item) => {
    const startX = e.clientX, startY = e.clientY;
    const el = e.currentTarget as HTMLElement;
    let moved = false;
    const onMove = (ev: PointerEvent) => {
      const dx = ev.clientX - startX;
      const dy = ev.clientY - startY;
      if (Math.abs(dy) > 24) {
        // vertical: it's a scroll, not a swipe
        cleanup();
        return;
      }
      if (Math.abs(dx) > 6) moved = true;
      el.style.transform = `translateX(${Math.max(-120, Math.min(120, dx))}px)`;
    };
    const onEnd = (ev: PointerEvent) => {
      const dx = ev.clientX - startX;
      el.style.transform = '';
      if (dx > 60) {
        // swipe right → mark read
        if (!item.read) void markRead(item.id).then(() => ctx.reloadItems());
      } else if (dx < -60) {
        // swipe left → toggle star
        void toggleStar(item.id).then(() => ctx.reloadItems());
      }
      cleanup();
    };
    const cleanup = () => {
      el.removeEventListener('pointermove', onMove);
      el.removeEventListener('pointerup', onEnd);
      el.removeEventListener('pointercancel', cleanup);
    };
    el.addEventListener('pointermove', onMove);
    el.addEventListener('pointerup', onEnd);
    el.addEventListener('pointercancel', cleanup);
  };

  const shouldShowSkeleton = () => {
    if (visibleItems().length > 0) return false;
    if (ctx.feeds().length === 0) return false;
    const fetching = ctx.fetchingFeeds();
    if (ctx.state.riverScope == null) return fetching.size > 0;
    return fetching.has(ctx.state.riverScope);
  };

  return (
    <main class="river" ref={containerRef} onMouseLeave={() => ctx.setState({ focusedIndex: -1 })}>
      <div class="river-inner">
        <For each={visibleItems()} fallback={shouldShowSkeleton() ? <SkeletonState /> : <EmptyState />}>
          {(item, idx) => (
            <article
              class={`river-item ${item.read ? 'read' : 'unread'}`}
              data-item-id={item.id}
              data-item-idx={idx()}
              classList={{ focused: idx() === ctx.state.focusedIndex }}
              onPointerDown={(e) => onStart(e, item)}
              onClick={(e) => {
                if ((e.currentTarget as HTMLElement).style.transform) return;
                void ctx.openItem(item);
              }}
              onMouseEnter={() => { mouseNav = true; ctx.setState({ focusedIndex: idx() }); }}
              onMouseLeave={() => ctx.setState({ focusedIndex: -1 })}
            >
              <div class="body">
                <div class="meta">
                  <span class="source">{ctx.feeds().find((f) => f.url === item.feedUrl)?.title ?? ''}</span>
                  <span class="time">{relativeTime(item.publishedAt)}</span>
                </div>
                <h3 class="title">
                  {item.title}
                  <Show when={item.starred}>
                    <Star size={14} fill="currentColor" class="star-inline" />
                  </Show>
                </h3>
                <Show when={item.excerpt}>
                  <div class="excerpt">{item.excerpt}</div>
                </Show>
              </div>
              <div class="actions">
                <button
                  class="action-btn read-toggle"
                  title={item.read ? 'Mark unread' : 'Mark read'}
                  onClick={(e) => {
                    e.stopPropagation();
                    void markRead(item.id, !item.read).then(() => ctx.reloadItems());
                  }}
                  aria-label={item.read ? 'Mark unread' : 'Mark read'}
                >
                  {item.read ? <CircleCheckIcon /> : <CircleIcon />}
                </button>
                <button
                  class="action-btn star-toggle"
                  title={item.starred ? 'Unstar' : 'Star'}
                  onClick={(e) => {
                    e.stopPropagation();
                    void toggleStar(item.id).then(() => ctx.reloadItems());
                  }}
                  aria-label={item.starred ? 'Unstar' : 'Star'}
                >
                  <Star size={14} fill={item.starred ? 'currentColor' : 'none'} />
                </button>
              </div>
            </article>
          )}
        </For>
      </div>
    </main>
  );
}

function SkeletonState() {
  return (
    <For each={Array.from({ length: 6 })}>
      {() => (
        <div class="skeleton-card">
          <div class="skeleton-circle" />
          <div class="skeleton-body">
            <div class="skeleton-line meta" />
            <div class="skeleton-line title" />
            <div class="skeleton-line excerpt" />
          </div>
        </div>
      )}
    </For>
  );
}

function EmptyState() {
  const ctx = useApp();
  const hasFeeds = ctx.feeds().length > 0;

  if (!hasFeeds) {
    return (
      <div class="empty-state">
        <div class="headline">Welcome to Sift</div>
        <a class="link" onClick={() => ctx.openModal({ kind: 'add-feed' })}>Add your first feed</a>
      </div>
    );
  }

  return (
    <div class="empty-state">
      <div class="headline">No items yet.</div>
      <a class="link" onClick={() => void ctx.refreshAll()}>Check for new items</a>
    </div>
  );
}