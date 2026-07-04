import { createSignal, createEffect, createMemo, Show } from 'solid-js';
import { useApp } from '../state';
import { ArrowLeft, ChevronLeft, ChevronRight, CircleQuestionMark, ExternalLink, Star } from 'lucide-solid';
import { openItemForReading } from '../articles/service';
import { toggleStar, markRead } from '../db/items';
import { humanRelativeTime } from '../util/time';

export function ReadingView() {
  const ctx = useApp();
  const [body, setBody] = createSignal<string>('');
  const [extractionFailed, setExtractionFailed] = createSignal(false);
  const [loading, setLoading] = createSignal(true);

  let scrollRef: HTMLDivElement | undefined;
  let lastItemId: string | undefined;

  const currentItem = () => ctx.state.currentItem;

  const hasPrev = createMemo(() => {
    const list = ctx.items();
    return ctx.state.focusedIndex > 0 && list.length > 1;
  });

  const hasNext = createMemo(() => {
    const list = ctx.items();
    return ctx.state.focusedIndex < list.length - 1 && list.length > 1;
  });

  const navigate = (offset: number) => {
    ctx.jumpTo(offset);
    const items = ctx.items();
    const item = items[ctx.state.focusedIndex];
    if (item) void ctx.openItem(item);
  };

  const feedName = () =>
    ctx.feeds().find((f) => f.url === currentItem()?.feedUrl)?.title ?? '';

  createEffect(() => {
    const item = currentItem();
    if (!item || item.id === lastItemId) return;
    lastItemId = item.id;

    if (!item.read) {
      void markRead(item.id).then(() => ctx.reloadItems());
    }
    setLoading(true);
    void openItemForReading(item.id).then((result) => {
      if (lastItemId !== item.id) return;
      setBody(result.bodyHtml);
      setExtractionFailed(result.extractionFailed);
      setLoading(false);
      scrollRef?.scrollTo({ top: 0, behavior: 'smooth' });
    });
  });

  const toggleStarClick = async () => {
    const item = currentItem();
    if (!item) return;
    await toggleStar(item.id);
    ctx.setState({
      currentItem: { ...item, starred: !item.starred },
    });
    void ctx.reloadItems();
  };

  const singleItem = () => ctx.items().length <= 1;

  return (
    <main class="reading">
      <div class="reading-chrome">
        <button class="back" onClick={() => ctx.closeReading()} title="Back (Esc)">
          <ArrowLeft size={14} />
        </button>
        <span class="chrome-spacer" />
        <div class="mobile-only chrome-chevrons">
          <button
            class="chrome-chevron"
            disabled={!hasPrev()}
            onClick={() => navigate(-1)}
            title="Previous article (j)"
            aria-label="Previous article"
          >
            <ChevronLeft size={14} />
          </button>
          <button
            class="chrome-chevron"
            disabled={!hasNext()}
            onClick={() => navigate(1)}
            title="Next article (k)"
            aria-label="Next article"
          >
            <ChevronRight size={14} />
          </button>
        </div>
        <button
          class="star"
          onClick={() => void toggleStarClick()}
          title={currentItem()?.starred ? 'Unstar (s)' : 'Star (s)'}
          aria-pressed={currentItem()?.starred ?? false}
          aria-label={currentItem()?.starred ? 'Unstar' : 'Star'}
        >
          <Star size={14} fill={currentItem()?.starred ? 'currentColor' : 'none'} />
        </button>
        <a
          class="open-original"
          href={currentItem()?.link ?? '#'}
          target="_blank"
          rel="noopener noreferrer"
          title="Open original"
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

      <div class="reading-body" ref={scrollRef}>
        <Show when={!loading() && currentItem()}>
          <div class="reading-content">
            <h1 class="reading-title">{currentItem()!.title}</h1>
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