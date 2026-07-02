import { useApp } from '../state';
import { unsubscribeFeed } from '../db/feeds';

export function ConfirmUnsubscribeModal() {
  const ctx = useApp();
  const modal = ctx.state.modal;
  if (modal.kind !== 'confirm-unsubscribe') return null;
  const { feedUrl, feedTitle } = modal;

  const handleConfirm = async () => {
    await unsubscribeFeed(feedUrl);
    await ctx.reloadFeeds();
    await ctx.reloadItems();
    void ctx.mcpNotifySync();
    if (ctx.state.riverScope === feedUrl) {
      ctx.setRiverScope(null);
    }
    ctx.closeModal();
  };

  return (
    <div class="modal modal-center">
      <div class="modal-header">Unsubscribe</div>
      <div class="modal-body">
        <p style={{ margin: 0, "line-height": "1.5" }}>
          Unsubscribe from <strong>{feedTitle}</strong>?
        </p>
        <p style={{ margin: "8px 0 0", "font-size": "13px", color: "var(--subtext)" }}>
          This will remove the feed and all its items. This cannot be undone.
        </p>
      </div>
      <div class="modal-footer">
        <button class="btn subtle" onClick={() => ctx.closeModal()}>Cancel</button>
        <button class="btn danger" onClick={() => void handleConfirm()}>
          Unsubscribe
        </button>
      </div>
    </div>
  );
}
