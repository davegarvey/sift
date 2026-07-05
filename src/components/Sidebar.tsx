import { For, Show } from 'solid-js';
import { useApp } from '../state';
import { Settings, Plus, Search, ChevronLeft, ChevronRight, TriangleAlert, X } from 'lucide-solid';
import { HelpIcon, RefreshIcon } from './Icons';
import type { Feed } from '../db/types';

export function Sidebar(props: { onNavigate?: () => void }) {
  const ctx = useApp();

  const selectAllFeeds = () => {
    ctx.setRiverScope(null);
    void ctx.saveSettingsPatch({ lastFeedUrl: null });
    void ctx.reloadItems();
    props.onNavigate?.();
  };

  const selectFeed = (feedUrl: string) => {
    ctx.setRiverScope(feedUrl);
    void ctx.saveSettingsPatch({ lastFeedUrl: feedUrl });
    void ctx.reloadItems();
    props.onNavigate?.();
  };

  const refreshing = () => ctx.fetching() > 0;
  const collapsed = () => ctx.state.sidebarHiddenDesktop;

  return (
    <nav class="sidebar" aria-label="Feeds" data-collapsed={String(collapsed())}>
      <Show when={!collapsed()}>
        <div class="sidebar-header">
          <div class="sidebar-wordmark">sift</div>
          <button
            class="sidebar-collapse"
            title="Close sidebar"
            onClick={() => ctx.toggleSidebarDesktop()}
          >
            <ChevronLeft size={14} />
          </button>
        </div>

        <div class="sidebar-add-feed">
          <button class="sidebar-action" onClick={() => ctx.openModal({ kind: 'add-feed' })}>
            + Add feed
          </button>
        </div>

        <button
          class="sidebar-action"
          title={refreshing() ? 'Refreshing…' : 'Refresh all feeds'}
          onClick={() => void ctx.refreshAll()}
          disabled={refreshing()}
          aria-label={refreshing() ? 'Refreshing feeds' : 'Refresh all feeds'}
        >
          <RefreshIcon spinning={refreshing()} />
          <span>Refresh</span>
        </button>

        <div class="section">
          <div class="heading">Feeds</div>
          <div
            class={`feed all-feeds ${ctx.state.riverScope === null ? 'active' : ''}`}
            onClick={selectAllFeeds}
          >
            <span class="title">All Feeds</span>
          </div>
          <For each={ctx.feeds()}>
            {(feed) => (
              <FeedRow
                feed={feed}
                errors={ctx.feedErrors()}
                fetchingFeeds={ctx.fetchingFeeds()}
                active={ctx.state.riverScope === feed.url}
                onClick={() => selectFeed(feed.url)}
                onDelete={() =>
                  ctx.openModal({
                    kind: 'confirm-unsubscribe',
                    feedUrl: feed.url,
                    feedTitle: feed.title,
                  })
                }
              />
            )}
          </For>
        </div>

        <div class="sidebar-actions-bottom">
          <button
            class="sidebar-action"
            title="Search / Command palette"
            onClick={() => ctx.openModal({ kind: 'palette' })}
          >
            <Search size={14} />
            <span>Palette</span>
          </button>
          <button
            class="sidebar-action"
            title="Settings"
            onClick={() => ctx.openModal({ kind: 'settings' })}
          >
            <Settings size={14} />
            <span>Settings</span>
          </button>
          <button
            class="sidebar-action desktop-only"
            title="Keyboard shortcuts (?)"
            onClick={() => ctx.openModal({ kind: 'shortcuts' })}
          >
            <HelpIcon />
            <span>Shortcuts</span>
          </button>
        </div>
      </Show>

      <Show when={collapsed()}>
        <div class="collapsed-rail" onClick={() => ctx.toggleSidebarDesktop()}>
          <div class="collapsed-brand">
            <span class="sift-mark">s</span>
            <span class="expand-icon">
              <ChevronRight size={14} />
            </span>
          </div>
          <div class="collapsed-actions-top" onClick={(e) => e.stopPropagation()}>
            <button class="collapsed-action" title="Add feed" onClick={() => ctx.openModal({ kind: 'add-feed' })}>
              <Plus size={14} />
            </button>
            <button
              class="collapsed-action"
              title={refreshing() ? 'Refreshing…' : 'Refresh all feeds'}
              onClick={() => void ctx.refreshAll()}
              disabled={refreshing()}
              aria-label={refreshing() ? 'Refreshing feeds' : 'Refresh all feeds'}
            >
              <RefreshIcon spinning={refreshing()} />
            </button>
          </div>
          <div class="collapsed-actions-bottom" onClick={(e) => e.stopPropagation()}>
            <button class="collapsed-action" title="Search / Command palette" onClick={() => ctx.openModal({ kind: 'palette' })}>
              <Search size={14} />
            </button>
            <button class="collapsed-action" title="Settings" onClick={() => ctx.openModal({ kind: 'settings' })}>
            <Settings size={14} />
            </button>
            <button class="collapsed-action desktop-only" title="Keyboard shortcuts (?)" onClick={() => ctx.openModal({ kind: 'shortcuts' })}>
              <HelpIcon />
            </button>
          </div>
        </div>
      </Show>
    </nav>
  );
}

interface FeedRowProps {
  feed: Feed;
  errors: Record<string, string>;
  active: boolean;
  fetchingFeeds: Set<string>;
  onClick: () => void;
  onDelete: () => void;
}

function FeedRow(props: FeedRowProps) {
  const error = () => props.errors[props.feed.url];
  const isFetching = () => props.fetchingFeeds.has(props.feed.url);
  return (
    <div class={`feed ${props.active ? 'active' : ''}`} onClick={props.onClick}>
      <span class="title">{props.feed.title}</span>
      <Show when={isFetching()}>
        <span class="fetching-spinner" title="Fetching…" />
      </Show>
      <Show when={error()}>
        <span class="error-mark" data-error={error()} title="Last refresh failed"><TriangleAlert size={12} /></span>
      </Show>
      <button class="delete-btn" title={`Unsubscribe from ${props.feed.title}`} onClick={(e) => { e.stopPropagation(); props.onDelete(); }}>
        <X size={12} strokeWidth={2.5} />
      </button>
    </div>
  );
}
