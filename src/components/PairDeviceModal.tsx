import { createSignal, Show, createMemo } from 'solid-js';
import { useApp } from '../state';
import { issueOtp, redeemCode } from '../sync/client';
import { renderSyncKeyQr } from '../sync/qr';
import { isValidSyncKey } from '../sync/key';

type Mode = 'source' | 'receiver';

export function PairDeviceModal(props: { mode: Mode; onClose: () => void }) {
  const ctx = useApp();
  const [code, setCode] = createSignal<string | null>(null);
  const [expiresAt, setExpiresAt] = createSignal<number | null>(null);
  const [error, setError] = createSignal<string | null>(null);
  const [input, setInput] = createSignal('');
  const [busy, setBusy] = createSignal(false);

  const key = () => ctx.syncKey();
  const qrSvg = createMemo(() => (key() ? renderSyncKeyQr(key()!) : ''));

  const requestCode = async () => {
    setError(null);
    setBusy(true);
    try {
      const res = await issueOtp();
      setCode(res.code);
      setExpiresAt(res.expiresAt);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to issue code');
    } finally {
      setBusy(false);
    }
  };

  const onSubmit = async (e: Event) => {
    e.preventDefault();
    setError(null);
    const v = input().trim();
    if (!v) return;
    setBusy(true);
    try {
      let key: string;
      if (v.length === 8) {
        key = await redeemCode(v);
      } else if (isValidSyncKey(v)) {
        key = v;
      } else {
        setError('Enter a valid 8-character code or 22-character sync key');
        return;
      }
      await ctx.pairSyncWithKey(key);
      props.onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to pair');
    } finally {
      setBusy(false);
    }
  };

  const remaining = () => {
    const e = expiresAt();
    if (!e) return 0;
    return Math.max(0, Math.floor((e - Date.now()) / 1000));
  };

  return (
    <div class="modal modal-center" onClick={(e) => e.target === e.currentTarget && props.onClose()}>
      <div class="modal-header">Pair another device</div>
      <div class="modal-body">
        <Show when={props.mode === 'source'}>
          <p style={{ margin: '0 0 12px', 'font-size': '13px', color: 'var(--subtext)' }}>
            Use one of the options below to pair another device with this one.
          </p>
          <Show when={key()}>
            <div class="sync-pair-grid">
              <div class="sync-pair-cell">
                <div class="sync-pair-label">Pairing code</div>
                <Show
                  when={code()}
                  fallback={
                    <button class="btn" onClick={() => void requestCode()} disabled={busy()}>
                      Issue code
                    </button>
                  }
                >
                  <div class="sync-pair-code" aria-label="Pairing code">{code()}</div>
                  <div class="sync-pair-countdown">
                    Expires in {Math.floor(remaining() / 60)}:{String(remaining() % 60).padStart(2, '0')}
                  </div>
                </Show>
                <div class="sync-pair-hint">
                  Type this on the other device under Settings → Sync.
                </div>
              </div>
              <div class="sync-pair-cell">
                <div class="sync-pair-label">Sync key</div>
                <div class="sync-pair-key">{key()}</div>
                <div class="sync-pair-hint">
                  Or paste the 22-character key directly on the other device.
                </div>
              </div>
              <div class="sync-pair-cell">
                <div class="sync-pair-label">QR code</div>
                <div class="sync-pair-qr" innerHTML={qrSvg()} />
                <div class="sync-pair-hint">
                  Camera scanning coming in v2.
                </div>
              </div>
            </div>
          </Show>
        </Show>
        <Show when={props.mode === 'receiver'}>
          <form onSubmit={onSubmit}>
            <p style={{ margin: '0 0 8px', 'font-size': '13px', color: 'var(--subtext)' }}>
              Paste the 8-character pairing code or 22-character sync key from the other device.
            </p>
            <input
              class="input"
              type="text"
              value={input()}
              onInput={(e) => setInput(e.currentTarget.value)}
              placeholder="Pairing code or sync key"
              autocomplete="off"
              autocorrect="off"
              autocapitalize="off"
              spellcheck={false}
              disabled={busy()}
            />
            <Show when={error()}>
              <div class="sync-error">{error()}</div>
            </Show>
            <div class="modal-footer" style={{ 'margin-top': '12px' }}>
              <button type="button" class="btn subtle" onClick={props.onClose}>Cancel</button>
              <button type="submit" class="btn" disabled={busy() || !input().trim()}>
                Pair
              </button>
            </div>
          </form>
        </Show>
      </div>
    </div>
  );
}
