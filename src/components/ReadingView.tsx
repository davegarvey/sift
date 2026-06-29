import { createSignal, createEffect, Show } from 'solid-js';
import { useApp } from '../state';
import { ArrowLeft, CircleQuestionMark, ExternalLink, Star } from 'lucide-solid';
import { openItemForReading } from '../articles/service';
import { toggleStar, markRead } from '../db/items';
import { relativeTime } from '../util/time';

export function ReadingView() {
  const ctx = useApp();
  const [body, setBody] = createSignal<string>('');
  const [extractionFailed, setExtractionFailed] = createSignal(false);
  const [loading, setLoading] = createSignal(true);

  let scrollRef: HTMLDivElement | undefined;
  let lastItemId: string | undefined;

  createEffect(() => {
    const item = ctx.state.currentItem;
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
    const item = ctx.state.currentItem;
    if (!item) return;
    await toggleStar(item.id);
    // Optimistically update local UI by reloading items; currentItem is
    // already a snapshot but we can patch its starred flag:
    ctx.setState({
      currentItem: { ...item, starred: !item.starred },
    });
    void ctx.reloadItems();
  };

  return (
    <main class="reading">
      <div class="reading-chrome">
        <button class="back" onClick={() => ctx.closeReading()} title="Back (Esc)">
          <ArrowLeft size={14} /> All
        </button>
        <span class="source">
          {ctx.feeds().find((f) => f.url === ctx.state.currentItem?.feedUrl)?.title ?? ''}
          {' · '}
          {ctx.state.currentItem ? relativeTime(ctx.state.currentItem.publishedAt) : ''}
        </span>
        <button
          class="star"
          onClick={() => void toggleStarClick()}
          title={ctx.state.currentItem?.starred ? 'Unstar (s)' : 'Star (s)'}
          aria-pressed={ctx.state.currentItem?.starred ?? false}
          aria-label={ctx.state.currentItem?.starred ? 'Unstar' : 'Star'}
        >
          <Star size={16} fill={ctx.state.currentItem?.starred ? 'currentColor' : 'none'} />
        </button>
        <a
          class="open-original"
          href={ctx.state.currentItem?.link ?? '#'}
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
        <Show when={!loading() && ctx.state.currentItem}>
          <div class="reading-content">
            <h1 class="reading-title">{ctx.state.currentItem!.title}</h1>
            <div class="byline">
              <Show when={ctx.state.currentItem!.author}>
                by {ctx.state.currentItem!.author}{' · '}
              </Show>
              <span>{new Date(ctx.state.currentItem!.publishedAt).toLocaleString()}</span>
            </div>
            <Show when={extractionFailed()}>
              <div class="extraction-notice">
                <span>Couldn't extract this article.</span>
                <a
                  class="open-original"
                  href={ctx.state.currentItem!.link ?? '#'}
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
    </main>
  );
}