import { For, Show, createMemo, createEffect, onCleanup } from 'solid-js';
import { useApp } from '../state';
import { markRead } from '../db/items';
import type { Item } from '../db/types';
import { relativeTime } from '../util/time';
import { normalizeTag } from '../util/tags';
import { Star } from 'lucide-solid';
import { CircleIcon, CircleCheckIcon } from './Icons';

export function River() {
  const ctx = useApp();
  let containerRef: HTMLDivElement | undefined;

  const visibleItems = createMemo(() => {
    const items = ctx.items();
    const tags = ctx.state.activeTags;
    if (tags.length > 0) {
      const tagSet = new Set(tags);
      const matchingFeeds = new Set(
        ctx.feeds().filter((f) => f.tags?.some((t) => {
          const normalized = normalizeTag(t);
          return normalized !== null && tagSet.has(normalized);
        })).map((f) => f.url)
      );
      if (matchingFeeds.size === 0) return items;
      return items.filter((i) => matchingFeeds.has(i.feedUrl));
    }
    if (ctx.state.riverScope == null) return items;
    return items.filter((i) => i.feedUrl === ctx.state.riverScope);
  });

  // Auto-scroll to the focused item when focusedIndex changes.
  // Guards against re-scrolling on periodic data reloads (idx === lastFocusedIdx).
  let lastFocusedEl: HTMLElement | null = null;
  let lastFocusedIdx = -1;
  let mouseNav = false;
  let programmaticScroll = false;

  createEffect(() => {
    const items = visibleItems();
    const returnToId = ctx.state.returnToItemId;
    const idx = ctx.state.focusedIndex;

    // Handle return-to-item restoration from reading view.
    if (returnToId != null) {
      const found = items.findIndex((i) => i.id === returnToId);
      if (found >= 0) {
        ctx.setState({ focusedIndex: found, returnToItemId: null });
      }
      return;
    }

    if (idx < 0 || idx >= items.length) { lastFocusedIdx = -1; return; }
    if (idx === lastFocusedIdx) return;
    const els = containerRef?.querySelectorAll('[data-item-idx]') ?? [];
    const target = els[idx] as HTMLElement | undefined;
    if (target && target !== lastFocusedEl) {
      programmaticScroll = true;
      target.scrollIntoView({
        behavior: 'auto',
        block: 'center',
      });
      lastFocusedEl = target;
      mouseNav = false;
    }
    lastFocusedIdx = idx;
  });

  // Clear focusedIndex when the user scrolls manually (touch / scrollbar / wheel).
  // Guard: ignore scroll events triggered by programmatic scrollIntoView above.
  createEffect(() => {
    const el = containerRef;
    if (!el) return;
    const onScroll = () => {
      if (programmaticScroll) {
        programmaticScroll = false;
        return;
      }
      if (ctx.state.focusedIndex >= 0) {
        ctx.setState({ focusedIndex: -1 });
      }
    };
    el.addEventListener('scroll', onScroll, { passive: true });
    onCleanup(() => el.removeEventListener('scroll', onScroll));
  });

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
        if (!item.read) void ctx.markReadAndSync(item, true);
      } else if (dx < -60) {
        // swipe left → toggle star
        void ctx.toggleStar(item);
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
                  <span class="source">{ctx.feedMap().get(item.feedUrl)?.title ?? ''}</span>
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
                    void ctx.markReadAndSync(item, !item.read);
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
                    void ctx.toggleStar(item);
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