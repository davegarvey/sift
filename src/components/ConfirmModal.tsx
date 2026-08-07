import { useApp } from '../state';

export function ConfirmModal() {
  const ctx = useApp();
  const modal = ctx.state.modal;
  if (modal.kind !== 'confirm') return null;
  const { title, message, hint, confirmLabel, danger, onConfirm, returnTo } = modal;

  const close = () => {
    ctx.closeModal();
    if (returnTo) ctx.openModal(returnTo);
  };

  const handleConfirm = async () => {
    try {
      await onConfirm();
    } catch (e) {
      // Callers surface their own errors; never strand the user on the dialog.
      console.error('Confirm action failed:', e);
    }
    ctx.closeModal();
    if (returnTo) ctx.openModal(returnTo);
  };

  return (
    <div class="modal modal-center">
      <div class="modal-header">{title}</div>
      <div class="modal-body">
        <p style={{ margin: 0, 'line-height': '1.5' }}>{message}</p>
        {hint && (
          <p style={{ margin: '8px 0 0', 'font-size': '13px', color: 'var(--subtext)' }}>{hint}</p>
        )}
      </div>
      <div class="modal-footer">
        <button class="btn subtle" onClick={close}>Cancel</button>
        <button class={danger ? 'btn danger' : 'btn'} onClick={() => void handleConfirm()}>
          {confirmLabel}
        </button>
      </div>
    </div>
  );
}
