import { onCleanup } from 'solid-js';
import { useApp } from '../state';

export function PairResultModal() {
  const ctx = useApp();
  const modal = ctx.state.modal;
  if (modal.kind !== 'pair-result') return null;
  const { success, message } = modal;

  if (success) {
    const timer = setTimeout(() => ctx.closeModal(), 4000);
    onCleanup(() => clearTimeout(timer));
  }

  return (
    <div class="modal modal-center" onClick={(e) => e.stopPropagation()}>
      <div class="modal-header">{success ? 'Sync Paired' : 'Pairing Failed'}</div>
      <div class="modal-body">
        <p style={{ margin: 0, 'line-height': '1.5', color: success ? 'var(--green)' : 'var(--red)' }}>
          {message}
        </p>
      </div>
      <div class="modal-footer">
        <button class="btn primary" onClick={() => ctx.closeModal()}>Close</button>
      </div>
    </div>
  );
}
