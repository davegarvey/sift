import { For, Show, createMemo } from 'solid-js';
import { useApp } from '../state';
import { Settings, Plus, Search, ChevronLeft, ChevronRight, TriangleAlert, Star, MoreHorizontal } from 'lucide-solid';
import { HelpIcon, RefreshIcon } from './Icons';
import type { Feed } from '../db/types';
import { normalizeTag } from '../util/tags';

export function Sidebar(props: { onNavigate?: () => void }) {
  const ctx = useApp();

  const selectFeed = (feed: Feed) => {
    ctx.clearTags();
    ctx.setRiverScope(feed.id);
    void ctx.saveSettingsPatch({ lastFeedUrl: feed.url });
    void ctx.reloadItems();
    props.onNavigate?.();
  };

  const selectAll = () => {
    ctx.clearTags();
    ctx.setRiverScope(null);
    void ctx.saveSettingsPatch({ lastFeedUrl: null });
    void ctx.reloadItems();
    props.onNavigate?.();
  };

  const hasActiveTags = () => ctx.state.activeTags.length > 0;

  const visibleFeeds = createMemo(() => {
    const tags = ctx.state.activeTags;
    if (tags.length === 0) return ctx.feeds();
    const tagSet = new Set(tags);
    return ctx.feeds().filter((f) => f.tags?.some((t) => {
      const normalized = normalizeTag(t);
      return normalized !== null && tagSet.has(normalized);
    }));
  });

  const refreshing = () => ctx.fetching() > 0;
  const collapsed = () => ctx.state.sidebarHiddenDesktop;

  return (
    <nav class="sidebar" aria-label="Feeds" data-collapsed={String(collapsed())}>
      <Show when={!collapsed()}>
        <div class="sidebar-header">
          <a class="sidebar-wordmark" href="/" title="Sift">sift</a>
          <button
            class="sidebar-collapse desktop-only"
            title="Close sidebar"
            onClick={() => ctx.toggleSidebarDesktop()}
          >
            <ChevronLeft size={14} />
          </button>
        </div>

        <div class="section">
          <div class="heading-row">
            <div class="heading">Feeds</div>
            <button
              class="heading-action"
              title="Add feed"
              aria-label="Add feed"
              onClick={() => ctx.openModal({ kind: 'add-feed' })}
            >
              <Plus size={14} />
            </button>
            <Show when={ctx.feeds().length > 0}>
              <button
                class="heading-action"
                title={refreshing() ? 'Refreshing…' : 'Refresh all feeds'}
                onClick={() => void ctx.refreshAll()}
                disabled={refreshing()}
                aria-label={refreshing() ? 'Refreshing feeds' : 'Refresh all feeds'}
              >
                <RefreshIcon spinning={refreshing()} />
              </button>
            </Show>
          </div>
          <Show when={ctx.feeds().length > 0}>
            <div class="tag-chips">
              <button
                class={`tag-chip ${ctx.state.riverScope === null && !hasActiveTags() ? 'active' : ''}`}
                onClick={selectAll}
                type="button"
              >
                all
              </button>
              <button
                class={`tag-chip ${ctx.state.starredOnly ? 'active' : ''}`}
                onClick={() => ctx.toggleStarFilter()}
                type="button"
                title="Toggle starred filter"
                aria-label="Toggle starred filter"
              >
                <Star size={14} />
              </button>
              <For each={ctx.allTags()}>
                {(tag) => (
                  <button
                    class={`tag-chip ${ctx.state.activeTags.includes(tag) ? 'active' : ''}`}
                    onClick={() => ctx.toggleTag(tag)}
                    type="button"
                  >
                    {tag}
                  </button>
                )}
              </For>
            </div>
          </Show>
          <div class="feed-list">
            <Show when={ctx.feeds().length > 0} fallback={ctx.hydrated() ? <div class="feed-list-empty">No feeds, yet.</div> : null}>
              <For each={visibleFeeds()}>
                {(feed) => (
                  <FeedRow
                    feed={feed}
                    errors={ctx.feedErrors()}
                    fetchingFeeds={ctx.fetchingFeeds()}
                    active={ctx.state.riverScope === feed.id}
                    onClick={() => selectFeed(feed)}
                    onEdit={() =>
                      ctx.openModal({
                        kind: 'feed-editor',
                        feedId: feed.id,
                      })
                    }
                  />
                )}
              </For>
            </Show>
          </div>
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
            <button
              class="collapsed-action"
              classList={{ active: ctx.state.starredOnly }}
              title="Toggle starred filter"
              aria-label="Toggle starred filter"
              onClick={() => ctx.toggleStarFilter()}
            >
              <Star size={14} />
            </button>
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
  onEdit: () => void;
}

function FeedRow(props: FeedRowProps) {
  const error = () => props.errors[props.feed.id];
  const isFetching = () => props.fetchingFeeds.has(props.feed.id);
  const retryLabel = () => {
    const err = props.feed.refreshError;
    if (!err) return null;
    const remaining = err.retryAt - Date.now();
    if (remaining <= 0) return null;
    const mins = Math.ceil(remaining / 60_000);
    return mins >= 60 ? `Retrying in ${Math.round(mins / 60)}h` : `Retrying in ${mins}m`;
  };
  return (
    <div class={`feed ${props.active ? 'active' : ''}`} onClick={props.onClick}>
      <span class="title">{props.feed.title}</span>
      <Show when={isFetching()}>
        <span class="fetching-spinner" title="Fetching…" />
      </Show>
      <Show when={error()}>
        <span class="error-mark" data-error={error()} title={retryLabel() ?? 'Last refresh failed'}><TriangleAlert size={12} /></span>
      </Show>
      <button class="edit-btn" title={`Edit ${props.feed.title}`} onClick={(e) => { e.stopPropagation(); props.onEdit(); }}>
        <MoreHorizontal size={14} />
      </button>
    </div>
  );
}
