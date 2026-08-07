import { Show, createSignal, onMount, onCleanup } from 'solid-js';
import { Check, Copy } from 'lucide-solid';
import { useApp } from '../state';
import { issueOtp, redeemCode, SyncClientError } from '../sync/client';
import { renderSyncKeyQr } from '../sync/qr';
import { isValidSyncKey } from '../sync/key';
import { QrScannerOverlay } from './QrScannerOverlay';
import { expiryLabel } from '../util/time';

export function PairDeviceModal() {
  const ctx = useApp();
  const enabled = () => Boolean(ctx.syncKey());
  const [mode, setMode] = createSignal<'show' | 'enter'>(enabled() ? 'show' : 'enter');
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
    } catch (e) {
      if (mounted) {
        if (e instanceof SyncClientError && e.status === 429) {
          setShareError('Too many codes issued recently. Try again in a few minutes.');
        } else if (e instanceof SyncClientError && (e.status === 401 || e.status === 403)) {
          setShareError('This server does not recognise your key. Regenerate it in Settings, or pair this device again.');
        } else if (e instanceof SyncClientError) {
          setShareError('Could not refresh the code. Try again.');
        } else {
          setShareError('Cannot reach the server. Check your connection and try again.');
        }
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

  const switchMode = (next: 'show' | 'enter') => {
    setMode(next);
    if (next === 'show' && !code()) void generateCode();
  };

  const doPair = async () => {
    const v = pairInput().trim();
    if (!v) return;
    let candidate = v;
    let isCode = false;
    if (v.length === 9 && v[4] === '-') candidate = v.slice(0, 4) + v.slice(5);
    if (candidate.length === 8) {
      isCode = true;
      candidate = candidate.toLowerCase();
    } else if (!isValidSyncKey(v)) {
      setPairError('Enter an 8-character code or a 22-character sync key');
      return;
    }
    setPairBusy(true);
    setPairError(null);
    try {
      if (isCode) {
        const key = await redeemCode(candidate);
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
    if (mode() === 'show') void generateCode();
  });

  onCleanup(() => {
    mounted = false;
    clearTimeout(expireTimer);
    clearInterval(ringTimer);
  });

  const displayCode = () => {
    const c = code();
    return c ? c.slice(0, 4) + '-' + c.slice(4) : '…';
  };

  return (
    <div class="modal modal-center">
      <div class="modal-header">{mode() === 'show' ? 'Pair a device' : 'Join an existing sync'}</div>
      <div class="modal-body">
        <Show when={!scanning()}>
          <Show when={mode() === 'show'}>
            <div style="margin-bottom: 10px; font-size: 13px; color: var(--subtext)">
              Open Sift on your other device and enter this code, or scan the QR code.
            </div>
            <div class="sync-grid sync-grid--single">
              <div class="sync-grid__cell">
                <span class="sync-grid__code">{displayCode()}</span>
                <div style="display: flex; gap: 6px; justify-content: center">
                  <button class="sync-grid__copy" onClick={() => void copyCode()} aria-label="Copy pairing code">
                    {copied() ? <Check size={14} /> : <Copy size={14} />}
                    <span style="font-size: 12px">Copy</span>
                  </button>
                </div>
                <div class="sync-grid__qr" innerHTML={pairUrl() ? renderSyncKeyQr(pairUrl()) : ''} />
                <Show when={shareError()}>
                  <p class="error" style="margin: 4px 0 0; text-align: center">{shareError()}</p>
                  <button class="btn" style="align-self: center" onClick={() => void generateCode()}>Retry</button>
                </Show>
              </div>
            </div>
          </Show>
          <Show when={mode() === 'enter'}>
            <div style="margin-bottom: 10px; font-size: 13px; color: var(--subtext)">
              Enter the code shown on your other device.
            </div>
            <form
              style="display: flex; gap: 6px; align-items: center"
              onSubmit={(e) => { e.preventDefault(); void doPair(); }}
            >
              <input
                type="text"
                value={pairInput()}
                onInput={(e) => setPairInput(e.currentTarget.value)}
                placeholder="abcd-efgh"
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
          </Show>
          <Show when={enabled()}>
            <button
              class="sync-grid__copy"
              style="margin-top: 10px"
              onClick={() => switchMode(mode() === 'show' ? 'enter' : 'show')}
            >
              {mode() === 'show' ? 'Enter a code from another device instead' : 'Show a code for the other device instead'}
            </button>
          </Show>
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
