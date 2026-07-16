import { createSignal } from 'solid-js';
import { useApp } from '../state';
import { updateFeedTags } from '../feeds/service';
import { TagInput } from './TagInput';

export function FeedEditorModal() {
  const ctx = useApp();
  const modal = ctx.state.modal;
  if (modal.kind !== 'feed-editor') return null;
  const { feedUrl, feedTitle } = modal;

  const feed = () => ctx.feedMap().get(feedUrl);
  const [tags, setTags] = createSignal<string[]>(feed()?.tags ?? []);

  const allTags = () => ctx.allTags();

  const handleTagsChange = async (newTags: string[]) => {
    setTags(newTags);
    await updateFeedTags(feedUrl, newTags);
    await ctx.reloadFeeds();
    await ctx.reloadItems();
  };

  const handleUnsubscribe = async () => {
    ctx.closeModal();
    ctx.openModal({ kind: 'confirm-unsubscribe', feedUrl, feedTitle });
  };

  return (
    <div class="modal modal-center">
      <div class="modal-header">Edit {feedTitle}</div>
      <div class="modal-body">
        <label style={{ display: 'block', 'font-size': '12px', 'margin-bottom': '6px', color: 'var(--subtext)' }}>
          Tags
        </label>
        <TagInput allTags={allTags()} value={tags()} onChange={handleTagsChange} placeholder="Add tag…" />
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
