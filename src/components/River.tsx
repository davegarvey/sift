import { For, Show, createMemo, createEffect, onCleanup } from 'solid-js';
import { useApp } from '../state';
import { markRead } from '../db/items';
import type { Item } from '../db/types';
import { relativeTime } from '../util/time';
import { normalizeTag } from '../util/tags';
import { Star, CircleCheck } from 'lucide-solid';
import { CircleIcon, CircleCheckIcon } from './Icons';

export function River() {
  const ctx = useApp();
  let containerRef: HTMLDivElement | undefined;

  const visibleItems = createMemo(() => {
    let items = ctx.items();
    const tags = ctx.state.activeTags;
    if (tags.length > 0) {
      const tagSet = new Set(tags);
      const matchingFeeds = new Set(
        ctx.feeds().filter((f) => f.tags?.some((t) => {
          const normalized = normalizeTag(t);
          return normalized !== null && tagSet.has(normalized);
        })).map((f) => f.id)
      );
      if (matchingFeeds.size > 0) items = items.filter((i) => matchingFeeds.has(i.feedId));
    } else if (ctx.state.riverScope != null) {
      items = items.filter((i) => i.feedId === ctx.state.riverScope);
    }
    if (ctx.state.starredOnly) items = items.filter((i) => i.starred);
    return items;
  });

  // Auto-scroll to the focused item when focusedIndex changes.
  // Guards against re-scrolling on periodic data reloads (idx === lastFocusedIdx).
  let lastFocusedEl: HTMLElement | null = null;
  let lastFocusedIdx = -1;
  let mouseNav = false;
  let lastKeyboardNav = 0;
  let mouseMoved = false;
  let lastMouseMoveTime = 0;

  createEffect(() => {
    const items = visibleItems();
    const returnToId = ctx.state.returnToItemId;
    const idx = ctx.state.focusedIndex;

    if (returnToId != null) {
      const found = items.findIndex((i) => i.id === returnToId);
      if (found >= 0) {
        const els = containerRef?.querySelectorAll('[data-item-idx]') ?? [];
        (els[found] as HTMLElement | undefined)?.scrollIntoView({ behavior: 'instant', block: 'center' });
      }
      ctx.setState({ returnToItemId: null, ...(found >= 0 ? { focusedIndex: found } : {}) });
      return;
    }

    if (idx < 0 || idx >= items.length) { lastFocusedIdx = -1; return; }
    if (idx === lastFocusedIdx) return;
    const els = containerRef?.querySelectorAll('[data-item-idx]') ?? [];
    const target = els[idx] as HTMLElement | undefined;
    if (target && target !== lastFocusedEl) {
      if (mouseNav) {
        // Mouse hover: highlight only, don't scroll.
        lastFocusedEl = target;
        lastFocusedIdx = idx;
        mouseNav = false;
        return;
      }
      lastKeyboardNav = performance.now();
      mouseMoved = false;
      target.scrollIntoView({
        behavior: 'auto',
        block: 'center',
      });
      lastFocusedEl = target;
      mouseNav = false;
    }
    lastFocusedIdx = idx;
  });

  // Clear focusedIndex when the user scrolls manually (wheel / trackpad).
  // Scroll events are unreliable — they fire for both programmatic and manual
  // scrolls — so we use wheel events which are always user-initiated.
  createEffect(() => {
    const el = containerRef;
    if (!el) return;
    const onWheel = () => {
      if (ctx.state.focusedIndex >= 0) ctx.setState({ focusedIndex: -1 });
    };
    el.addEventListener('wheel', onWheel, { passive: true });
    onCleanup(() => el.removeEventListener('wheel', onWheel));
  });

  // Render items swipe handler (touch-only, gmail-style reveal).
  const isTouchDevice = typeof window !== 'undefined' && window.matchMedia('(any-pointer: coarse)').matches;
  let swiped = false;
  const onStart = (e: PointerEvent, item: Item) => {
    if (!isTouchDevice) return;
    const startX = e.clientX, startY = e.clientY;
    const el = e.currentTarget as HTMLElement;
    const container = el.closest('.swipe-container') as HTMLElement | null;
    el.setPointerCapture(e.pointerId);
    let moved = false;
    const onMove = (ev: PointerEvent) => {
      const dx = ev.clientX - startX;
      const dy = ev.clientY - startY;
      if (Math.abs(dy) > 24) {
        cleanup();
        return;
      }
      if (Math.abs(dx) > 6) moved = true;
      const clamped = Math.max(-80, Math.min(80, dx));
      el.style.transform = `translateX(${clamped}px)`;
      if (container) container.classList.toggle('swiping', Math.abs(clamped) > 0);
    };
    const onEnd = (ev: PointerEvent) => {
      const dx = ev.clientX - startX;
      el.style.transform = '';
      if (container) container.classList.remove('swiping');
      swiped = moved;
      if (dx > 60) {
        void ctx.markReadAndSync(item, !item.read);
      } else if (dx < -60) {
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
    <main class="river" ref={containerRef} onMouseLeave={() => ctx.setState({ focusedIndex: -1 })} onMouseMove={() => { mouseMoved = true; lastMouseMoveTime = performance.now(); }}>
      <div class="river-inner">
        <For each={visibleItems()} fallback={shouldShowSkeleton() ? <SkeletonState /> : <EmptyState />}>
          {(item, idx) => (
            <div class="swipe-container">
              <div class="swipe-reveal left">
                <CircleCheck size={22} />
              </div>
              <div class="swipe-reveal right">
                <Star size={22} />
              </div>
              <article
                class={`river-item ${item.read ? 'read' : 'unread'}`}
                data-item-id={item.id}
                data-item-idx={idx()}
                classList={{ focused: idx() === ctx.state.focusedIndex }}
                onPointerDown={(e) => onStart(e, item)}
                onClick={() => {
                  if (swiped) { swiped = false; return; }
                  void ctx.openItem(item);
                }}
                onMouseEnter={() => {
                  if (performance.now() - lastMouseMoveTime > 200) return;
                  if (performance.now() - lastKeyboardNav < 500 && !mouseMoved) return;
                  mouseNav = true;
                  ctx.setState({ focusedIndex: idx() });
                }}
              >
                <div class="body">
                  <div class="meta">
                    <span class="source">{ctx.feedMap().get(item.feedId)?.title ?? ''}</span>
                    <span class="time">{relativeTime(item.publishedAt)}</span>
                  </div>
                  <h3 class="title">
                    {item.title}
                  </h3>
                  <Show when={item.excerpt}>
                    <div class="excerpt">{item.excerpt}</div>
                  </Show>
                </div>
                <div class="actions">
                  <button
                    class="action-btn read-toggle"
                    title={item.read ? 'Mark unread' : 'Mark read'}
                    onPointerDown={(e) => e.stopPropagation()}
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
                    classList={{ starred: item.starred }}
                    title={item.starred ? 'Unstar' : 'Star'}
                    onPointerDown={(e) => e.stopPropagation()}
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
            </div>
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

  if (ctx.state.starredOnly) {
    return (
      <div class="empty-state">
        <div class="headline">No starred items</div>
        <a class="link" onClick={() => ctx.toggleStarFilter()}>Disable star filter</a>
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