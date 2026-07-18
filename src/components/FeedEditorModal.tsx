import { createSignal, Show, onCleanup } from 'solid-js';
import { useApp } from '../state';
import { updateFeedMeta, changeFeedUrl, updateFeedTags } from '../feeds/service';
import { TagInput } from './TagInput';

export function FeedEditorModal() {
  const ctx = useApp();
  const modal = ctx.state.modal;
  if (modal.kind !== 'feed-editor') return null;
  const { feedId } = modal;

  const feed = () => ctx.feedMap().get(feedId);

  const [localTitle, setLocalTitle] = createSignal(feed()?.title ?? '');
  const [localUrl, setLocalUrl] = createSignal(feed()?.url ?? '');
  const initialUrl = feed()?.url ?? '';
  const [urlError, setUrlError] = createSignal<string | null>(null);

  const allTags = () => ctx.allTags();

  let titleTimer: ReturnType<typeof setTimeout> | null = null;

  const scheduleTitleSave = (title: string) => {
    if (titleTimer) clearTimeout(titleTimer);
    titleTimer = setTimeout(async () => {
      const f = feed();
      if (!f) return;
      await updateFeedMeta(f.id, { title });
      await ctx.reloadFeeds();
    }, 500);
  };

  onCleanup(() => {
    if (titleTimer) clearTimeout(titleTimer);
  });

  const handleTitleInput = (e: Event) => {
    const value = (e.currentTarget as HTMLInputElement).value;
    setLocalTitle(value);
    scheduleTitleSave(value);
  };

  const handleUrlBlur = async () => {
    const newUrl = localUrl().trim();
    const f = feed();
    if (!f || newUrl === f.url) {
      setUrlError(null);
      return;
    }
    if (!newUrl) {
      setUrlError('URL is required');
      return;
    }
    try {
      const parsed = new URL(newUrl);
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
        setUrlError('URL must start with http:// or https://');
        return;
      }
    } catch {
      setUrlError('Enter a valid URL');
      return;
    }
    try {
      await changeFeedUrl(f.id, newUrl);
      await ctx.reloadFeeds();
      setUrlError(null);
    } catch (e) {
      setUrlError((e as Error).message || 'Failed to update URL');
    }
  };

  const handleUnsubscribe = async () => {
    ctx.closeModal();
    ctx.openModal({ kind: 'confirm-unsubscribe', feedId });
  };

  const feedTitle = () => feed()?.title ?? '';

  return (
    <div class="modal feed-editor modal-center">
      <div class="modal-header">Edit Feed</div>
      <div class="modal-body">
        <label style={{ display: 'block', 'margin-bottom': '12px' }}>
          <span style={{ display: 'block', 'font-size': '12px', 'margin-bottom': '4px', color: 'var(--subtext)' }}>Name</span>
          <input
            type="text"
            value={localTitle()}
            onInput={handleTitleInput}
            placeholder="Feed name"
            style={{ width: '100%' }}
          />
        </label>
        <label style={{ display: 'block', 'margin-bottom': '12px' }}>
          <span style={{ display: 'block', 'font-size': '12px', 'margin-bottom': '4px', color: 'var(--subtext)' }}>URL</span>
          <input
            type="url"
            value={localUrl()}
            onInput={(e) => { setLocalUrl(e.currentTarget.value); setUrlError(null); }}
            onBlur={() => void handleUrlBlur()}
            placeholder="https://example.com/feed"
            style={{ width: '100%' }}
          />
          <Show when={urlError()}>
            <span class="error" style={{ 'font-size': '12px', 'margin-top': '4px', display: 'block' }}>{urlError()}</span>
          </Show>
        </label>
        <label style={{ display: 'block', 'font-size': '12px', 'margin-bottom': '6px', color: 'var(--subtext)' }}>
          Tags
        </label>
        <TagInput allTags={allTags()} value={feed()?.tags ?? []} onChange={(tags) => { void ctx.updateFeedTags(feedId, tags); }} placeholder="Add tag…" />
      </div>
      <div class="modal-footer" style={{ 'justify-content': 'space-between' }}>
        <button class="btn danger" onClick={() => void handleUnsubscribe()}>
          Unsubscribe
        </button>
        <div>
          <button class="btn subtle" onClick={() => ctx.closeModal()}>Done</button>
        </div>
      </div>
    </div>
  );
}
