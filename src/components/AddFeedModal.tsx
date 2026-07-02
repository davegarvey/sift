import { createSignal, Show, For, onMount } from 'solid-js';
import { useApp } from '../state';
import { discoverFeed } from '../feeds/discover';
import { upsertFeed } from '../db/feeds';
import { bulkUpsertItems } from '../db/items';
import { parsedToItems } from '../feeds/parse';
import type { DiscoveredFeed } from '../feeds/discover';

export function AddFeedModal() {
  const ctx = useApp();
  const [url, setUrl] = createSignal('');
  const [discovered, setDiscovered] = createSignal<DiscoveredFeed | null>(null);
  const [discovering, setDiscovering] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);

  let inputRef: HTMLInputElement | undefined;

  onMount(() => {
    requestAnimationFrame(() => inputRef?.focus());
  });

  const urlError = () => {
    const raw = url().trim();
    if (!raw) return null;
    try {
      const parsed = new URL(raw);
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
        return 'URL must start with http:// or https://';
      }
      return null;
    } catch {
      return 'Enter a valid URL';
    }
  };

  const discover = async () => {
    setError(null);
    setDiscovered(null);
    setDiscovering(true);
    try {
      const d = await discoverFeed(url().trim());
      if (!d) {
        setError("Couldn't find a feed at this URL");
      } else {
        setDiscovered(d);
      }
    } catch (e) {
      setError((e as Error).message || 'Discovery failed');
    } finally {
      setDiscovering(false);
    }
  };

  const subscribe = async () => {
    const d = discovered();
    if (!d) return;
    await upsertFeed({
      url: d.url,
      title: d.title,
      learnedIntervalMs: 60 * 60 * 1000,
      lastFetched: null,
      lastItemPublishedAt: null,
    });
    ctx.closeModal();
    void ctx.reloadFeeds();
    void ctx.mcpNotifySync();
    const items = parsedToItems(d.parsed, d.url);
    if (items.length > 0) {
      await bulkUpsertItems(items);
      const lastPublished = Math.max(...items.map((i) => i.publishedAt));
      await upsertFeed({
        url: d.url,
        title: d.title,
        learnedIntervalMs: 60 * 60 * 1000,
        lastFetched: Date.now(),
        lastItemPublishedAt: lastPublished ?? null,
      });
    }
    void ctx.reloadItems();
  };

  return (
    <div class="modal add-feed">
      <div class="modal-header">Add feed</div>
      <div class="modal-body">
        <input
          ref={inputRef}
          type="url"
          placeholder="Paste a website or feed URL…"
          value={url()}
          onInput={(e) => setUrl(e.currentTarget.value)}
          onPaste={() => !discovering() && setTimeout(() => void discover(), 0)}
          onKeyDown={(e) => e.key === 'Enter' && void discover()}
          disabled={!!discovered()}
        />
        <Show when={!discovering() && !error() && urlError()}>
          <p class="error" style="margin: 4px 0 0 0">{urlError()}</p>
        </Show>
        <Show when={discovering()}>
          <p style={{ "font-size": "13px", color: "var(--subtext)", margin: "8px 0" }}>
            Discovering…
          </p>
        </Show>
        <Show when={error()}>
          <p class="error">{error()}</p>
          <button class="btn" onClick={() => void discover()}>Retry</button>{' '}
          <button class="btn subtle" onClick={() => ctx.closeModal()}>Cancel</button>
        </Show>
        <Show when={discovered()}>
          <div class="samples">
            <div>Found: <strong>{discovered()!.title}</strong></div>
            <Show when={discovered()!.samples.length > 0}>
              <div style={{ "font-size": "12px", "margin-top": "6px", color: "var(--subtext)" }}>
                Recent items:
              </div>
              <ul>
                <For each={discovered()!.samples}>{(s) => <li>{s}</li>}</For>
              </ul>
            </Show>
          </div>
        </Show>
      </div>
      <div class="modal-footer">
        <button class="btn subtle" onClick={() => ctx.closeModal()}>Cancel</button>
        <Show when={discovered()}>
          <button class="btn primary" onClick={() => void subscribe()}>Subscribe</button>
        </Show>
        <Show when={!discovered() && !error()}>
          <button class="btn primary" onClick={() => void discover()} disabled={discovering() || !url().trim() || !!urlError()}>
            Discover
          </button>
        </Show>
      </div>
    </div>
  );
}