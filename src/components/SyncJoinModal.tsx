import { Show, createSignal } from 'solid-js';
import { useApp } from '../state';
import { redeemCode } from '../sync/client';
import { QrScannerOverlay } from './QrScannerOverlay';

export function SyncJoinModal() {
  const ctx = useApp();
  const [pairInput, setPairInput] = createSignal('');
  const [pairError, setPairError] = createSignal<string | null>(null);
  const [pairBusy, setPairBusy] = createSignal(false);
  const [scanning, setScanning] = createSignal(false);
  const [cameraAvail, setCameraAvail] = createSignal<boolean | null>(null);

  if (navigator.mediaDevices) {
    void navigator.mediaDevices.enumerateDevices().then(devices => {
      setCameraAvail(devices.some(d => d.kind === 'videoinput'));
    }).catch(() => setCameraAvail(false));
  } else {
    setCameraAvail(false);
  }

  const doPair = async () => {
    const v = pairInput().trim();
    if (!v) return;
    if (v.length !== 8) {
      setPairError('Enter an 8-character pairing code');
      return;
    }
    setPairBusy(true);
    setPairError(null);
    try {
      const key = await redeemCode(v);
      await ctx.pairSyncWithKey(key);
      ctx.closeModal();
      ctx.openModal({ kind: 'pair-result', success: true, message: 'Paired successfully' });
    } catch (e) {
      setPairError(e instanceof Error ? e.message : 'Pairing failed');
    } finally {
      setPairBusy(false);
    }
  };

  const handleScannerClose = (paired?: boolean) => {
    setScanning(false);
    if (paired) {
      ctx.closeModal();
      ctx.openModal({ kind: 'pair-result', success: true, message: 'Paired successfully' });
    }
  };

  return (
    <div class="modal modal-center">
      <div class="modal-header">Join existing sync</div>
      <div class="modal-body">
        <Show when={!scanning()}>
          <div style="margin-bottom: 4px; font-size: 13px; color: var(--subtext)">Enter pairing code</div>
          <div style="display: flex; gap: 6px; align-items: center">
            <input
              type="text"
              value={pairInput()}
              onInput={(e) => setPairInput(e.currentTarget.value)}
              placeholder="8-character code"
              autocomplete="off"
              autocorrect="off"
              autocapitalize="off"
              spellcheck={false}
              disabled={pairBusy()}
              style={{ width: '160px', 'flex': 'none', 'font-size': '13px', padding: '6px 8px', background: 'var(--surface)', color: 'var(--text)', border: '1px solid var(--hairline)', 'border-radius': '4px' }}
            />
            <button
              class="btn"
              disabled={pairBusy() || !pairInput().trim()}
              onClick={() => void doPair()}
            >
              {pairBusy() ? 'Pairing…' : 'Pair'}
            </button>
          </div>
          <Show when={pairError()}>
            <p class="error" style={{ margin: '8px 0 0', 'font-size': '13px' }}>{pairError()}</p>
          </Show>
          <div class="sync-or-divider">
            <span />
            <span>or</span>
            <span />
          </div>
          <div style="margin-bottom: 4px; font-size: 13px; color: var(--subtext)">Scan QR code</div>
          <button
            class="btn"
            disabled={cameraAvail() === false}
            onClick={() => setScanning(true)}
            title={cameraAvail() === false ? 'No camera detected' : 'Scan QR code from another device'}
          >
            Scan QR
          </button>
        </Show>
        <Show when={scanning()}>
          <QrScannerOverlay onClose={handleScannerClose} />
        </Show>
      </div>
      <div class="modal-footer">
        <button class="btn primary" onClick={() => ctx.closeModal()}>Close</button>
      </div>
    </div>
  );
}
