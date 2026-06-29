import { createSignal, Show, For, onMount } from 'solid-js';
import { useApp } from '../state';
import { discoverFeed } from '../feeds/discover';
import { upsertFeed } from '../db/feeds';
import { refreshFeed } from '../feeds/scheduler';
import type { DiscoveredFeed } from '../feeds/discover';

function looksLikeUrl(s: string): boolean {
  try {
    const u = new URL(s.startsWith('http') ? s : `https://${s}`);
    return u.hostname.includes('.');
  } catch {
    return false;
  }
}

export function AddFeedModal() {
  const ctx = useApp();
  const [url, setUrl] = createSignal('');
  const [discovered, setDiscovered] = createSignal<DiscoveredFeed | null>(null);
  const [discovering, setDiscovering] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);

  let inputRef: HTMLInputElement | undefined;

  onMount(async () => {
    // 1. Pre-fill from clipboard if it looks like a URL.
    // navigator.clipboard.readText() requires a secure context + the
    // transient-activation that came from the click that opened the modal.
    // If it fails (or returns nothing URL-like), we silently skip.
    if (navigator.clipboard?.readText) {
      try {
        const clip = await navigator.clipboard.readText();
        if (clip && looksLikeUrl(clip.trim())) {
          setUrl(clip.trim());
        }
      } catch {
        // Permission denied or no clipboard access — ignore.
      }
    }
    // 2. Focus the input so the user can paste/confirm immediately. Defer
    // one frame so the modal is fully painted before focus.
    requestAnimationFrame(() => inputRef?.focus());
  });

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
    });
    ctx.closeModal();
    void ctx.reloadFeeds();
    void refreshFeed({
      url: d.url,
      title: d.title,
      learnedIntervalMs: 60 * 60 * 1000,
      lastFetched: null,
    });
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
          onKeyDown={(e) => e.key === 'Enter' && void discover()}
          disabled={!!discovered()}
        />
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
          <button class="btn primary" onClick={() => void discover()} disabled={discovering() || !url().trim()}>
            Discover
          </button>
        </Show>
      </div>
    </div>
  );
}