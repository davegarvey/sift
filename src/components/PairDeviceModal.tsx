import { Show, createSignal, onMount, onCleanup } from 'solid-js';
import { Check, Copy } from 'lucide-solid';
import { useApp } from '../state';
import { issueOtp, redeemCode } from '../sync/client';
import { renderSyncKeyQr } from '../sync/qr';
import { isValidSyncKey } from '../sync/key';
import { QrScannerOverlay } from './QrScannerOverlay';
import { expiryLabel } from '../util/time';

export function PairDeviceModal() {
  const ctx = useApp();
  const [code, setCode] = createSignal<string | null>(null);
  const [expiresAt, setExpiresAt] = createSignal<number | null>(null);
  const [copied, setCopied] = createSignal(false);
  const [ringFraction, setRingFraction] = createSignal(1);
  const [shareError, setShareError] = createSignal<string | null>(null);
  const [pairInput, setPairInput] = createSignal('');
  const [pairError, setPairError] = createSignal<string | null>(null);
  const [pairBusy, setPairBusy] = createSignal(false);
  const [scanning, setScanning] = createSignal(false);
  const [cameraAvail, setCameraAvail] = createSignal<boolean | null>(null);
  let expireTimer: ReturnType<typeof setTimeout> | undefined;
  let ringTimer: ReturnType<typeof setInterval> | undefined;
  let mounted = true;

  if (navigator.mediaDevices) {
    void navigator.mediaDevices.enumerateDevices().then(devices => {
      setCameraAvail(devices.some(d => d.kind === 'videoinput'));
    }).catch(() => setCameraAvail(false));
  } else {
    setCameraAvail(false);
  }

  const startRingTimer = (exp: number) => {
    clearInterval(ringTimer);
    setRingFraction(1);
    ringTimer = setInterval(() => {
      const remaining = exp - Date.now();
      setRingFraction(Math.max(0, remaining / (5 * 60 * 1000)));
    }, 1000);
  };

  const generateCode = async () => {
    clearTimeout(expireTimer);
    try {
      const res = await issueOtp();
      if (!mounted) return;
      setCode(res.code);
      setExpiresAt(res.expiresAt);
      setShareError(null);
      startRingTimer(res.expiresAt);
      const delay = res.expiresAt - Date.now();
      if (delay > 0) {
        expireTimer = setTimeout(() => void generateCode(), delay);
      }
    } catch {
      if (mounted) {
        setShareError('Could not refresh the code. Tap to retry.');
      }
    }
  };

  const copyCode = async () => {
    if (!code()) return;
    await navigator.clipboard.writeText(code()!);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const pairUrl = () => code() ? window.location.origin + '/?pair=' + code()! : '';

  const doPair = async () => {
    const v = pairInput().trim();
    if (!v) return;
    if (v.length !== 8 && !isValidSyncKey(v)) {
      setPairError('Enter an 8-character code or a 22-character sync key');
      return;
    }
    setPairBusy(true);
    setPairError(null);
    try {
      if (v.length === 8) {
        const key = await redeemCode(v);
        await ctx.pairSyncWithKey(key);
      } else {
        if (v === ctx.syncKey()) {
          setPairError('Already paired with this key');
          return;
        }
        await ctx.pairSyncWithKey(v);
      }
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

  onMount(() => {
    void generateCode();
  });

  onCleanup(() => {
    mounted = false;
    clearTimeout(expireTimer);
    clearInterval(ringTimer);
  });

  return (
    <div class="modal modal-center">
      <div class="modal-header">Pair a device</div>
      <div class="modal-body">
        <Show when={!scanning()}>
          <div class="sync-grid">
            <div class="sync-grid__cell">
              <span class="sync-grid__label">On your other device</span>
              <span class="sync-grid__code">{code() ?? '…'}</span>
              <div style="display: flex; gap: 6px; justify-content: center">
                <button class="sync-grid__copy" onClick={() => void copyCode()} aria-label="Copy pairing code">
                  {copied() ? <Check size={14} /> : <Copy size={14} />}
                  <span style="font-size: 12px">Copy</span>
                </button>
              </div>
              <div class="sync-grid__qr" innerHTML={pairUrl() ? renderSyncKeyQr(pairUrl()) : ''} />
              <span class="sync-grid__hint">Open Sift on your other device, then enter the code or scan the QR code.</span>
              <Show when={shareError()}>
                <p class="error" style="margin: 4px 0 0; text-align: center">{shareError()}</p>
                <button class="btn" style="align-self: center" onClick={() => void generateCode()}>Retry</button>
              </Show>
            </div>
            <div class="sync-grid__cell">
              <span class="sync-grid__label">This device is new</span>
              <form
                style="display: flex; gap: 6px; align-items: center"
                onSubmit={(e) => { e.preventDefault(); void doPair(); }}
              >
                <input
                  type="text"
                  value={pairInput()}
                  onInput={(e) => setPairInput(e.currentTarget.value)}
                  placeholder="8-character code"
                  aria-label="Pairing code or sync key"
                  autocomplete="off"
                  autocorrect="off"
                  autocapitalize="off"
                  spellcheck={false}
                  disabled={pairBusy()}
                  style={{ width: '160px', 'flex': 'none', 'font-size': '13px', padding: '6px 8px', background: 'var(--surface)', color: 'var(--text)', border: '1px solid var(--hairline)', 'border-radius': '4px' }}
                />
                <button
                  class="btn"
                  type="submit"
                  disabled={pairBusy() || !pairInput().trim()}
                >
                  {pairBusy() ? 'Pairing…' : 'Pair'}
                </button>
              </form>
              <Show when={pairError()}>
                <p class="error">{pairError()}</p>
              </Show>
              <button
                class="btn"
                style="align-self: flex-start"
                disabled={cameraAvail() === false}
                onClick={() => setScanning(true)}
                title={cameraAvail() === false ? 'No camera detected' : 'Scan a pairing QR code'}
              >
                Scan QR
              </button>
              <span class="sync-grid__hint">Enter the code shown on your other device, or scan its QR code.</span>
            </div>
          </div>
        </Show>
        <Show when={scanning()}>
          <QrScannerOverlay onClose={handleScannerClose} />
        </Show>
      </div>
      <div class="modal-footer" style="justify-content: space-between">
        <div style="display: flex; align-items: center; gap: 6px; font-size: 12px; color: var(--subtext)">
          <svg class="code-timer" viewBox="0 0 24 24" aria-hidden="true">
            <circle class="code-timer__bg" cx="12" cy="12" r="10" />
            <circle
              class="code-timer__progress"
              cx="12" cy="12" r="10"
              stroke-dasharray={`${2 * Math.PI * 10}`}
              stroke-dashoffset={`${2 * Math.PI * 10 * (1 - ringFraction())}`}
              style={{ stroke: ringFraction() > 0.1 ? undefined : 'var(--red)' }}
            />
          </svg>
          <Show when={expiresAt()}>
            {`Expires in ${expiryLabel(expiresAt()!)}`}
          </Show>
        </div>
        <button class="btn primary" onClick={() => ctx.closeModal()}>Close</button>
      </div>
    </div>
  );
}
