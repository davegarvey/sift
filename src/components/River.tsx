import { For, onMount, onCleanup, Show, createMemo } from 'solid-js';
import { useApp } from '../state';
import { listItemsByFeed } from '../db/items';
import { markRead, toggleStar } from '../db/items';
import type { Item } from '../db/types';
import { relativeTime } from '../util/time';

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
  const onFocusChange = () => {
    const list = visibleItems();
    const idx = ctx.state.focusedIndex;
    if (idx < 0 || idx >= list.length) return;
    const els = containerRef?.querySelectorAll('[data-item-idx]') ?? [];
    const target = els[idx] as HTMLElement | undefined;
    if (target && target !== lastFocusedEl) {
      target.scrollIntoView({ block: 'nearest' });
      lastFocusedEl = target;
    }
  };

// Item references for IntersectionObserver-based implicit mark read.
  // Behavior matches the convention used by NetNewsWire / Reeder / Feedbin /
  // Feedly: an item is only ever marked read by scroll-past IF it has been
  // visible to the user at some point ("was seen"). Items rendered below the
  // fold that the user has never actually seen are NOT marked read.
  // See design note in tasks.md (group 7, task 7.4 divergence).
  let observer: IntersectionObserver | null = null;
  const leaveTimers = new Map<string, ReturnType<typeof setTimeout>>();
  const hasBeenSeen = new Set<string>();

  const setupObserver = () => {
    if (!containerRef || !ctx.settings().markReadOnScrollPast) {
      observer?.disconnect();
      observer = null;
      return;
    }
    observer?.disconnect();
    observer = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          const id = (e.target as HTMLElement).dataset.itemId!;
          const item = visibleItems().find((i) => i.id === id);
          if (!item || item.read) continue;
          if (e.isIntersecting) {
            // Mark "seen" and cancel any pending leave-timer.
            hasBeenSeen.add(id);
            const t = leaveTimers.get(id);
            if (t) {
              clearTimeout(t);
              leaveTimers.delete(id);
            }
          } else if (hasBeenSeen.has(id) && !leaveTimers.has(id)) {
            // Was seen, now scrolled away → start the small delay so fast
            // scrolling past does not race the marking.
            leaveTimers.set(
              id,
              setTimeout(() => {
                void markRead(id).then(() => ctx.reloadItems());
                leaveTimers.delete(id);
              }, 500),
            );
          }
        }
      },
      { root: containerRef, threshold: 0.01 },
    );
    containerRef
      .querySelectorAll('[data-item-id]')
      .forEach((el) => observer!.observe(el));
  };

  // Reset seen set when the river scope changes (filter by feed / All) so
  // re-rendered items start fresh.
  // On unmount, dispose observer + pending timers.
  onCleanup(() => {
    observer?.disconnect();
    for (const t of leaveTimers.values()) clearTimeout(t);
    leaveTimers.clear();
    hasBeenSeen.clear();
  });

  // Re-setup observer when items change.
  const refreshObserver = () => requestAnimationFrame(setupObserver);

  onMount(() => {
    refreshObserver();
    onFocusChange();
  });
  // SolidJS doesn't have onUpdated here; use a tiny interval to refresh.
  onMount(() => {
    const id = setInterval(refreshObserver, 1000);
    onCleanup(() => clearInterval(id));
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

  return (
    <main class="river" ref={containerRef}>
      <div class="river-inner">
        <For each={visibleItems()} fallback={<EmptyState />}>
          {(item, idx) => (
            <article
              class={`river-item ${item.read ? 'read' : 'unread'}`}
              data-item-id={item.id}
              data-item-idx={idx()}
              classList={{ focused: idx() === ctx.state.focusedIndex }}
              onPointerDown={(e) => onStart(e, item)}
              onClick={(e) => {
                // Don't open if this was the end of a swipe
                if ((e.currentTarget as HTMLElement).style.transform) return;
                void ctx.openItem(item);
              }}
              onMouseEnter={() => ctx.setState({ focusedIndex: idx() })}
            >
              <button
                class="indicator tick"
                title={item.read ? 'Mark unread' : 'Mark read'}
                onClick={(e) => {
                  e.stopPropagation();
                  void markRead(item.id, !item.read).then(() =>
                    ctx.reloadItems(),
                  );
                }}
                aria-pressed={item.read}
                aria-label={item.read ? 'Mark unread' : 'Mark read'}
              />
              <div class="body">
                <div class="meta">
                  <span class="source">{ctx.feeds().find((f) => f.url === item.feedUrl)?.title ?? ''}</span>
                  <span class="time">{relativeTime(item.publishedAt)}</span>
                </div>
                <h3 class="title">{item.title}</h3>
                <Show when={item.excerpt}>
                  <div class="excerpt">{item.excerpt}</div>
                </Show>
              </div>
              <Show when={item.starred}>
                <span class="star">★</span>
              </Show>
            </article>
          )}
        </For>
      </div>
    </main>
  );
}

function EmptyState() {
  const ctx = useApp();
  const hasFeeds = ctx.feeds().length > 0;
  const isUnreadMode = ctx.state.readFilter === 'unread';

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
      <div class="headline">
        {isUnreadMode ? "You're all caught up." : 'No items yet.'}
      </div>
      <a class="link" onClick={() => void ctx.refreshAll()}>Check for new items</a>
    </div>
  );
}