import { createSignal, For, Show, createMemo } from 'solid-js';
import { useApp } from '../state';
import { upsertFeed } from '../db/feeds';
import type { Feed } from '../db/types';
import { refreshFeed } from '../feeds/scheduler';

export function Sidebar(props: { onNavigate?: () => void }) {
  const ctx = useApp();
  const [foldersCollapsed, setFoldersCollapsed] = createSignal<Record<string, boolean>>({});

  const selectView = (scope: string | null, filter: 'unread' | 'all') => {
    ctx.setState({ riverScope: scope, readFilter: filter, focusedIndex: 0, view: 'river' });
    void ctx.saveSettingsPatch({ lastFeedUrl: scope, readFilter: filter });
    props.onNavigate?.();
  };

  const selectFeed = (feedUrl: string) => {
    ctx.setRiverScope(feedUrl);
    void ctx.saveSettingsPatch({ lastFeedUrl: feedUrl });
    props.onNavigate?.();
  };

  // Group feeds by folder. Top-level feeds (no folder) appear under a
  // synthetic "Feeds" pseudo-folder; we render them flat for simplicity.
  const grouped = createMemo(() => {
    const feeds = ctx.feeds();
    const map = new Map<string, Feed[]>();
    const unclassified: Feed[] = [];
    for (const f of feeds) {
      const path = f.folder ?? [];
      const key = path[path.length - 1];
      if (!key) {
        unclassified.push(f);
      } else {
        if (!map.has(key)) map.set(key, []);
        map.get(key)!.push(f);
      }
    }
    return { map, unclassified };
  });

  // Count unreads per feed by walking items (cheap for v0 feeds).
  const unreadCount = (feedUrl: string) =>
    ctx.items().filter((i) => i.feedUrl === feedUrl && !i.read).length;
  const totalUnread = () => ctx.items().filter((i) => !i.read).length;
  const allActive = () => ctx.state.riverScope === null && ctx.state.readFilter === 'all';
  const unreadActive = () => ctx.state.riverScope === null && ctx.state.readFilter === 'unread';

  return (
    <nav class="sidebar" aria-label="Feeds">
      <div class="section">
        <div
          class={`all ${unreadActive() ? 'active' : ''}`}
          onClick={() => selectView(null, 'unread')}
        >
          <span class="title">Unread</span>
          <Show when={totalUnread() > 0}>
            <span class="unread-count">{totalUnread()}</span>
          </Show>
        </div>
        <div
          class={`all ${allActive() ? 'active' : ''}`}
          onClick={() => selectView(null, 'all')}
        >
          <span class="title">All</span>
        </div>
      </div>

      <Show when={grouped().map.size > 0}>
        <div class="section">
          <For each={Array.from(grouped().map.keys())}>
            {(folder) => (
              <>
                <div
                  class="folder"
                  onClick={() =>
                    setFoldersCollapsed((s) => ({ ...s, [folder]: !s[folder] }))
                  }
                >
                  <span style={{ "margin-right": "4px" }}>
                    {foldersCollapsed()[folder] ? '▸' : '▾'}
                  </span>
                  <span class="title">{folder}</span>
                </div>
                <Show when={!foldersCollapsed()[folder]}>
                  <For each={grouped().map.get(folder)}>
                    {(feed) => (
                      <FeedRow feed={feed} unread={unreadCount(feed.url)} errors={ctx.feedErrors()} active={ctx.state.riverScope === feed.url} onClick={() => selectFeed(feed.url)} />
                    )}
                  </For>
                </Show>
              </>
            )}
          </For>
        </div>
      </Show>

      <Show when={grouped().unclassified.length > 0}>
        <div class="section">
          <div class="heading">Feeds</div>
          <For each={grouped().unclassified}>
            {(feed) => (
              <FeedRow feed={feed} unread={unreadCount(feed.url)} errors={ctx.feedErrors()} active={ctx.state.riverScope === feed.url} onClick={() => selectFeed(feed.url)} />
            )}
          </For>
        </div>
      </Show>

      <div class="add-feed">
        <button class="pill" style={{ padding: "6px 10px" }} onClick={() => ctx.openModal({ kind: 'add-feed' })}>
          + Add feed
        </button>
      </div>
    </nav>
  );
}

interface FeedRowProps {
  feed: Feed;
  unread: number;
  errors: Record<string, string>;
  active: boolean;
  onClick: () => void;
}

function FeedRow(props: FeedRowProps) {
  const error = () => props.errors[props.feed.url];
  return (
    <div class={`feed ${props.active ? 'active' : ''}`} onClick={props.onClick}>
      <span class="title">{props.feed.title}</span>
      <Show when={error()}>
        <span class="error-mark" data-error={error()} title="Last refresh failed">⚠</span>
      </Show>
      <Show when={props.unread > 0}>
        <span class="unread-count">{props.unread}</span>
      </Show>
    </div>
  );
}