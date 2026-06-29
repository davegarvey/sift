import { createSignal, onMount, onCleanup, Show } from 'solid-js';
import { useApp } from '../state';
import { openItemForReading } from '../articles/service';
import { toggleStar, markRead } from '../db/items';
import { relativeTime } from '../util/time';

export function ReadingView() {
  const ctx = useApp();
  const [body, setBody] = createSignal<string>('');
  const [extractionFailed, setExtractionFailed] = createSignal(false);
  const [loading, setLoading] = createSignal(true);

  let scrollRef: HTMLDivElement | undefined;

  onMount(async () => {
    const item = ctx.state.currentItem;
    if (!item) {
      ctx.closeReading();
      return;
    }
    if (!item.read) {
      void markRead(item.id).then(() => ctx.reloadItems());
    }
    setLoading(true);
    const result = await openItemForReading(item.id);
    setBody(result.bodyHtml);
    setExtractionFailed(result.extractionFailed);
    setLoading(false);
    // Reset scroll on opening.
    scrollRef?.scrollTo({ top: 0 });
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
          ‹ All
        </button>
        <span class="source">
          {ctx.feeds().find((f) => f.url === ctx.state.currentItem?.feedUrl)?.title ?? ''}
          {' · '}
          {ctx.state.currentItem ? relativeTime(ctx.state.currentItem.publishedAt) : ''}
        </span>
        <button
          class={`star ${ctx.state.currentItem?.starred ? '' : 'dim'}`}
          onClick={() => void toggleStarClick()}
          title="Star (s)"
          aria-pressed={ctx.state.currentItem?.starred ?? false}
          aria-label="Toggle star"
        >
          ★
        </button>
        <a
          class="open-original"
          href={ctx.state.currentItem?.link ?? '#'}
          target="_blank"
          rel="noopener noreferrer"
          title="Open original"
        >
          ↗ open
        </a>
      </div>

      <div class="reading-body" ref={scrollRef}>
        <Show when={!loading() && ctx.state.currentItem}>
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
                Open original ↗
              </a>
            </div>
          </Show>
          <div innerHTML={body()} />
        </Show>
        <Show when={loading()}>
          <p>Loading…</p>
        </Show>
      </div>
    </main>
  );
}