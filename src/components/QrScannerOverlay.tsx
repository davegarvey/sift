import { Show, createSignal, onMount, onCleanup } from 'solid-js';
import { useApp } from '../state';
import { redeemCode } from '../sync/client';

type ScanState = 'scanning' | 'pairing' | 'error';

export function QrScannerOverlay(props: { onClose: (paired?: boolean) => void }) {
  const ctx = useApp();
  const [state, setState] = createSignal<ScanState>('scanning');
  const [errorMsg, setErrorMsg] = createSignal('');
  let videoRef: HTMLVideoElement | undefined;
  let canvasRef: HTMLCanvasElement | undefined;
  let stream: MediaStream | undefined;
  let frameTimer: ReturnType<typeof setInterval> | undefined;
  let mounted = true;

  const handleKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.stopPropagation();
      props.onClose(false);
    }
  };

  const stopCamera = () => {
    if (stream) {
      for (const t of stream.getTracks()) t.stop();
      stream = undefined;
    }
    if (videoRef) videoRef.srcObject = null;
  };

  onCleanup(() => {
    mounted = false;
    if (frameTimer) clearInterval(frameTimer);
    stopCamera();
    document.removeEventListener('keydown', handleKey);
  });

  const processFrame = async () => {
    if (!videoRef || !canvasRef || !mounted) return;
    const video = videoRef;
    const canvas = canvasRef;
    const w = Math.min(video.videoWidth || 640, 320);
    const h = Math.min(video.videoHeight || 480, 240);
    canvas.width = w;
    canvas.height = h;
    const ctx2d = canvas.getContext('2d');
    if (!ctx2d) return;
    ctx2d.drawImage(video, 0, 0, w, h);
    const imageData = ctx2d.getImageData(0, 0, w, h);
    try {
      const { default: jsQR } = await import('jsqr');
      const result = jsQR(imageData.data, imageData.width, imageData.height);
      if (!result) return;
      let url: URL;
      try {
        url = new URL(result.data);
      } catch {
        return;
      }
      if (url.origin !== window.location.origin) return;
      const pairCode = url.searchParams.get('pair');
      if (!pairCode) return;
      if (frameTimer) clearInterval(frameTimer);
      frameTimer = undefined;
      setState('pairing');
      const key = await redeemCode(pairCode);
      await ctx.pairSyncWithKey(key);
      if (navigator.vibrate) navigator.vibrate(100);
      setTimeout(() => { if (mounted) props.onClose(true); }, 1200);
    } catch {
      setState('error');
      setErrorMsg('Failed to pair. The code may have expired. Try again or enter the code manually.');
    }
  };

  const startFrameLoop = () => {
    frameTimer = setInterval(() => void processFrame(), 500);
  };

  const startCamera = async () => {
    setErrorMsg('');
    setState('scanning');
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: 'environment' }, width: { ideal: 640 }, height: { ideal: 480 } },
      });
      if (!videoRef || !mounted) { stopCamera(); return; }
      videoRef.srcObject = stream;
      await videoRef.play();
      startFrameLoop();
    } catch (e: unknown) {
      const err = e as DOMException;
      if (err.name === 'NotAllowedError') {
        setErrorMsg('Camera permission denied. Grant access in your browser settings or enter the code manually.');
      } else if (err.name === 'NotFoundError') {
        setErrorMsg('No camera found on this device. Enter the pairing code manually.');
      } else if (err.name === 'NotReadableError') {
        setErrorMsg('Camera is busy (e.g., in use by another app). Close other apps that use the camera and try again.');
      } else if (err.name === 'AbortError') {
        setErrorMsg('Camera permission prompt was dismissed. Tap "Scan QR" to try again.');
      } else {
        setErrorMsg(`Camera error: ${(err as Error).message || 'Unknown'}. Enter the pairing code manually.`);
      }
      setState('error');
    }
  };

  const handleRetry = () => {
    stopCamera();
    stream = undefined;
    if (frameTimer) { clearInterval(frameTimer); frameTimer = undefined; }
    if (videoRef) videoRef.srcObject = null;
    setTimeout(() => void startCamera(), 100);
  };

  onMount(() => {
    document.addEventListener('keydown', handleKey);
    void startCamera();
  });

  return (
    <div class="scanner-overlay" role="dialog" aria-modal="true" aria-label="QR code scanner">
      <button
        class="scanner-close"
        onClick={() => props.onClose(false)}
        aria-label="Close scanner"
      >
        ✕
      </button>
      <div class="scanner-viewfinder">
        <video ref={videoRef} class="scanner-video" autoplay playsinline muted aria-label="Camera view for QR code scanning" />
        <canvas ref={canvasRef} class="scanner-canvas" aria-hidden="true" />
        <div class="scanner-target" aria-hidden="true">
          <svg viewBox="0 0 100 100" class="scanner-target-svg">
            <path d="M20,4 H4 V20" fill="none" stroke="currentColor" stroke-width="6" stroke-linecap="round" />
            <path d="M80,4 H96 V20" fill="none" stroke="currentColor" stroke-width="6" stroke-linecap="round" />
            <path d="M20,96 H4 V80" fill="none" stroke="currentColor" stroke-width="6" stroke-linecap="round" />
            <path d="M80,96 H96 V80" fill="none" stroke="currentColor" stroke-width="6" stroke-linecap="round" />
          </svg>
        </div>
      </div>
      <Show when={state() === 'scanning'}>
        <div class="scanner-status">Scanning…</div>
      </Show>
      <Show when={state() === 'pairing'}>
        <div class="scanner-status">Pairing…</div>
      </Show>
      <Show when={state() === 'error'}>
        <div class="scanner-error">{errorMsg()}</div>
        <div class="scanner-actions">
          <button class="btn" onClick={handleRetry}>Try again</button>
          <button class="btn subtle" onClick={() => props.onClose(false)}>Enter code manually</button>
        </div>
      </Show>
      <Show when={state() !== 'pairing'}>
        <button class="scanner-cancel" onClick={() => props.onClose(false)}>Cancel</button>
      </Show>
    </div>
  );
}
