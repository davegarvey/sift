import { createSignal, createEffect, createMemo, Show, onMount, onCleanup } from 'solid-js';
import { useApp } from '../state';
import { ArrowLeft, ChevronLeft, ChevronRight, CircleQuestionMark, ExternalLink, Star } from 'lucide-solid';
import { openItemForReading } from '../articles/service';
import { humanRelativeTime } from '../util/time';
import { SWIPE, swipeDirection, isVerticalDominant, clampTranslate } from '../util/swipe';

export function ReadingView() {
  const ctx = useApp();
  const [body, setBody] = createSignal<string>('');
  const [extractionFailed, setExtractionFailed] = createSignal(false);
  const [loading, setLoading] = createSignal(true);
  const [showChromeTitle, setShowChromeTitle] = createSignal(false);
  const [displayTitle, setDisplayTitle] = createSignal('');

  let titleRef: HTMLHeadingElement | undefined;
  let containerRef: HTMLDivElement | undefined;
  let scrollRef: HTMLDivElement | undefined;
  let lastItemId: string | undefined;

  const currentItem = () => ctx.state.currentItem;

  const hasPrev = createMemo(() => {
    const list = ctx.items();
    return ctx.state.focusedIndex > 0 && list.length > 1;
  });

  const hasNext = createMemo(() => {
    const list = ctx.items();
    return ctx.state.focusedIndex >= 0 && ctx.state.focusedIndex < list.length - 1 && list.length > 1;
  });

  const navigate = (offset: number) => {
    ctx.jumpTo(offset);
    const items = ctx.items();
    const item = items[ctx.state.focusedIndex];
    if (item) void ctx.openItem(item, true);
  };

  const feedName = () =>
    ctx.feeds().find((f) => f.id === currentItem()?.feedId)?.title ?? '';

  createEffect(() => {
    const item = currentItem();
    if (!item || item.id === lastItemId) return;
    lastItemId = item.id;

    if (!item.read) {
      void ctx.markReadAndSync(item, true);
    }
    setLoading(true);
    void openItemForReading(item.id).then((result) => {
      if (lastItemId !== item.id) return;
      setBody(result.bodyHtml);
      setExtractionFailed(result.extractionFailed);
      setLoading(false);
      containerRef?.scrollTo({ top: 0 });
    });
  });

  onMount(() => {
    containerRef?.focus({ preventScroll: true });
    if (!titleRef || !containerRef) return;
    const observer = new IntersectionObserver(
      ([e]) => setShowChromeTitle(!e.isIntersecting),
      { root: containerRef, rootMargin: '-35px 0px 0px 0px' }
    );
    observer.observe(titleRef);
    onCleanup(() => observer.disconnect());
  });

  createEffect(() => {
    if (loading()) setShowChromeTitle(false);
  });

  createEffect(() => {
    const item = currentItem();
    if (item && !loading()) setDisplayTitle(item.title);
  });

  createEffect(() => {
    const item = currentItem();
    document.title = item ? `${item.title} — Sift` : 'Sift';
  });
  onCleanup(() => { document.title = 'Sift'; });

  const toggleStarClick = async () => {
    const item = currentItem();
    if (!item) return;
    await ctx.toggleStar(item);
    ctx.setState({
      currentItem: { ...item, starred: !item.starred },
    });
  };

  const singleItem = () => ctx.items().length <= 1;

  // --- Swipe prev/next navigation (touch-only) -------------------------------
  // Mirrors the river swipe engine's discipline: dead zone before any visual
  // shift, axis lock that bails into native scroll, clamped finger-follow,
  // commit threshold, and full cleanup on pointercancel. Gestures that start
  // in the screen-edge zones are left to the browser's native back/forward
  // swipe, and touches on interactive / horizontally scrollable elements are
  // never captured.
  const isTouchDevice = typeof window !== 'undefined' && window.matchMedia('(any-pointer: coarse)').matches;

  const isExcludedTarget = (t: EventTarget | null): boolean => {
    if (!(t instanceof Element)) return true;
    if (t.closest('a, button, iframe, video, embed, audio, input, textarea, select, [contenteditable]')) return true;
    let node: Element | null = t;
    while (node && node !== containerRef) {
      const style = getComputedStyle(node);
      if ((style.overflowX === 'auto' || style.overflowX === 'scroll') && node.scrollWidth > node.clientWidth + 1) return true;
      node = node.parentElement;
    }
    return false;
  };

  const onSwipeStart = (e: PointerEvent) => {
    if (!isTouchDevice || e.pointerType !== 'touch') return;
    if (e.clientX < SWIPE.EDGE_ZONE || e.clientX > window.innerWidth - SWIPE.EDGE_ZONE) return;
    if (isExcludedTarget(e.target)) return;
    const startX = e.clientX;
    const startY = e.clientY;
    const bodyEl = scrollRef;
    if (!bodyEl) return;
    bodyEl.setPointerCapture(e.pointerId);
    let active = false;

    const cleanup = () => {
      bodyEl.style.transition = 'transform 200ms ease';
      bodyEl.style.transform = '';
      bodyEl.removeEventListener('pointermove', onMove);
      bodyEl.removeEventListener('pointerup', onEnd);
      bodyEl.removeEventListener('pointercancel', onCancel);
    };
    const onMove = (ev: PointerEvent) => {
      const dx = ev.clientX - startX;
      const dy = ev.clientY - startY;
      if (!active) {
        if (isVerticalDominant(dx, dy, SWIPE.AXIS_LOCK)) { cleanup(); return; }
        if (Math.abs(dx) <= SWIPE.DEAD_ZONE) return;
        active = true;
      }
      bodyEl.style.transition = 'none';
      bodyEl.style.transform = `translateX(${clampTranslate(dx, SWIPE.CLAMP)}px)`;
    };
    const onEnd = (ev: PointerEvent) => {
      const dx = ev.clientX - startX;
      const dir = swipeDirection(dx, SWIPE.COMMIT);
      bodyEl.style.transition = 'transform 200ms ease';
      bodyEl.style.transform = '';
      bodyEl.removeEventListener('pointermove', onMove);
      bodyEl.removeEventListener('pointerup', onEnd);
      bodyEl.removeEventListener('pointercancel', onCancel);
      if (!active) return;
      if (dir === 1 && hasNext()) navigate(1);
      else if (dir === -1 && hasPrev()) navigate(-1);
    };
    const onCancel = () => cleanup();
    bodyEl.addEventListener('pointermove', onMove);
    bodyEl.addEventListener('pointerup', onEnd);
    bodyEl.addEventListener('pointercancel', onCancel);
  };

  return (
    <main class="reading" ref={containerRef} tabindex="-1" onPointerDown={onSwipeStart}>
      <div class="reading-chrome">
          <div class="reading-chrome-inner">
            <button class="back" onClick={() => ctx.closeReading()} title="Back (Esc)">
              <ArrowLeft size={14} />
            </button>
            <span class="chrome-spacer">
              <span class="chrome-title" data-shown={showChromeTitle() || undefined} data-loading={loading() || undefined}>
                {displayTitle()}
              </span>
            </span>
            <button
              class="star desktop-only"
              onClick={() => void toggleStarClick()}
              title={currentItem()?.starred ? 'Unstar (s)' : 'Star (s)'}
              aria-pressed={currentItem()?.starred ?? false}
              aria-label={currentItem()?.starred ? 'Unstar' : 'Star'}
            >
              <Star size={14} fill={currentItem()?.starred ? 'currentColor' : 'none'} />
            </button>
            <a
              class="open-original desktop-only"
              href={currentItem()?.link ?? '#'}
              target="_blank"
              rel="noopener noreferrer"
              title="Open"
            >
              <ExternalLink size={14} />
            </a>
            <button
              class="desktop-only"
              title="Keyboard shortcuts (?)"
              onClick={() => ctx.openModal({ kind: 'shortcuts' })}
            >
              <CircleQuestionMark size={14} />
            </button>
          </div>
      </div>

      <div class="reading-body" ref={scrollRef}>
        <Show when={currentItem()}>
          <h1 class="reading-title" ref={titleRef}>{currentItem()!.title}</h1>
          <Show when={!loading()}>
            <div class="reading-content">
              <div class="byline">
                <Show when={currentItem()!.author}>
                  by {currentItem()!.author}{' · '}
                </Show>
                {feedName()}
                {' · '}
                <span>{humanRelativeTime(new Date(currentItem()!.publishedAt))}</span>
              </div>
              <Show when={extractionFailed()}>
                <div class="extraction-notice">
                  <span>Couldn't extract this article.</span>
                  <a
                    class="open-original"
                    href={currentItem()!.link ?? '#'}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    <ExternalLink size={14} />
                  </a>
                </div>
              </Show>
              <div innerHTML={body()} />
            </div>
          </Show>
        </Show>

      </div>

      <div class="reading-bottom-bar mobile-only">
        <Show when={!singleItem()}>
          <button
            class="bottom-bar-btn prev"
            disabled={!hasPrev()}
            onClick={() => navigate(-1)}
            title="Previous article (k)"
            aria-label="Previous article"
          >
            <ChevronLeft size={18} />
          </button>
        </Show>
        <div class="bottom-bar-center">
          <button
            class="bottom-bar-btn star"
            onClick={() => void toggleStarClick()}
            title={currentItem()?.starred ? 'Unstar (s)' : 'Star (s)'}
            aria-pressed={currentItem()?.starred ?? false}
            aria-label={currentItem()?.starred ? 'Unstar' : 'Star'}
          >
            <Star size={18} fill={currentItem()?.starred ? 'currentColor' : 'none'} />
          </button>
          <a
            class="bottom-bar-btn open-original"
            href={currentItem()?.link ?? '#'}
            target="_blank"
            rel="noopener noreferrer"
            title="Open"
            aria-label="Open original"
          >
            <ExternalLink size={18} />
          </a>
        </div>
        <Show when={!singleItem()}>
          <button
            class="bottom-bar-btn next"
            disabled={!hasNext()}
            onClick={() => navigate(1)}
            title="Next article (j)"
            aria-label="Next article"
          >
            <ChevronRight size={18} />
          </button>
        </Show>
      </div>

      <Show when={!singleItem()}>
        <div
          class="reading-zone reading-zone-prev desktop-only"
          classList={{ ghosted: !hasPrev() }}
          onClick={() => hasPrev() && navigate(-1)}
        >
          <ChevronLeft size={24} />
        </div>
        <div
          class="reading-zone reading-zone-next desktop-only"
          classList={{ ghosted: !hasNext() }}
          onClick={() => hasNext() && navigate(1)}
        >
          <ChevronRight size={24} />
        </div>
      </Show>
    </main>
  );
}
