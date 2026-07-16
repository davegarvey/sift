import { createSignal, onMount, onCleanup } from 'solid-js';
import { Check, Copy } from 'lucide-solid';
import { useApp } from '../state';
import { issueOtp } from '../sync/client';
import { renderSyncKeyQr } from '../sync/qr';

export function SyncShareModal() {
  const ctx = useApp();
  const [code, setCode] = createSignal<string | null>(null);
  const [expiresAt, setExpiresAt] = createSignal<number | null>(null);
  const [copied, setCopied] = createSignal(false);
  const [ringFraction, setRingFraction] = createSignal(1);
  let expireTimer: ReturnType<typeof setTimeout> | undefined;
  let ringTimer: ReturnType<typeof setInterval> | undefined;
  let mounted = true;

  const startRingTimer = (exp: number) => {
    clearInterval(ringTimer);
    setRingFraction(1);
    ringTimer = setInterval(() => {
      const remaining = exp - Date.now();
      const total = 5 * 60 * 1000;
      setRingFraction(Math.max(0, remaining / total));
    }, 1000);
  };

  const generateCode = async () => {
    clearTimeout(expireTimer);
    try {
      const res = await issueOtp();
      if (!mounted) return;
      setCode(res.code);
      setExpiresAt(res.expiresAt);
      startRingTimer(res.expiresAt);
      const delay = res.expiresAt - Date.now();
      if (delay > 0) {
        expireTimer = setTimeout(() => void generateCode(), delay);
      }
    } catch {
      if (mounted) {
        setCode(null);
        setExpiresAt(null);
      }
    }
  };

  const copyCode = async () => {
    if (!code()) return;
    await navigator.clipboard.writeText(code()!);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  onMount(() => {
    void generateCode();
  });

  onCleanup(() => {
    mounted = false;
    clearTimeout(expireTimer);
    clearInterval(ringTimer);
  });

  const pairUrl = () => code() ? window.location.origin + '/?pair=' + code()! : '';

  return (
    <div class="modal modal-center">
      <div class="modal-header">Add another device</div>
      <div class="modal-body">
        <div class="sync-grid">
          <div class="sync-grid__cell">
            <span class="sync-grid__label">Pairing code</span>
            <span class="sync-grid__code">{code() ?? '…'}</span>
            <div style="display: flex; gap: 6px; justify-content: center">
              <button class="sync-grid__copy" onClick={() => void copyCode()} aria-label="Copy pairing code">
                {copied() ? <Check size={14} /> : <Copy size={14} />}
                <span style="font-size: 12px">Copy</span>
              </button>
            </div>
          </div>
          <div class="sync-grid__cell">
            <span class="sync-grid__label">QR code</span>
            <div class="sync-grid__qr" innerHTML={pairUrl() ? renderSyncKeyQr(pairUrl()) : ''} />
            <span class="sync-grid__hint">Open Sift on your other device and scan</span>
          </div>
        </div>
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
          {expiresAt() && `Expires in ${Math.ceil((expiresAt()! - Date.now()) / 60000)} min`}
        </div>
        <button class="btn primary" onClick={() => ctx.closeModal()}>Close</button>
      </div>
    </div>
  );
}
