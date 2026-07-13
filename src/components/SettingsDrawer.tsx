import { ExternalLink, Check, Copy, RefreshCw } from 'lucide-solid';
import { version } from '../../package.json';
import { Show, For, createSignal, createMemo } from 'solid-js';
import { useApp } from '../state';
import type { ThemePreference } from '../db/types';
import { serializeOpml } from '../opml/serialize';
import { parseOpml } from '../opml/parse';
import { buildMergePreview, applyMerge } from '../opml/merge';
import { isSyncAvailable } from '../sync/capabilities';
import { issueOtp, redeemCode } from '../sync/client';
import { renderSyncKeyQr } from '../sync/qr';

export function SettingsDrawer() {
  const ctx = useApp();
  const settings = ctx.settings;
  const [syncAvail, setSyncAvail] = createSignal<boolean | null>(null);
  void isSyncAvailable().then(setSyncAvail);

  const setTheme = (theme: ThemePreference) => {
    void ctx.saveSettingsPatch({ theme });
  };

  const triggerExport = async () => {
    const opml = serializeOpml(ctx.feeds());
    const blob = new Blob([opml], { type: 'text/xml' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'sift-subscriptions.opml';
    a.click();
    URL.revokeObjectURL(url);
  };

  const triggerImport = () => {
    document.getElementById('opml-file-input')?.click();
  };

  const onFileChosen = async (e: Event) => {
    const input = e.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    const text = await file.text();
    const parsed = parseOpml(text);
    const preview = await buildMergePreview(parsed);
    if (confirm(`Import ${preview.newSubscriptions.length} feeds? (${preview.skipped} already subscribed, ${preview.total} total found)`)) {
      await applyMerge(preview);
      await ctx.reloadFeeds();
      void ctx.mcpNotifySync();
      void ctx.refreshAll();
    }
    input.value = '';
  };

  return (
    <div class="modal settings">
      <div class="modal-header">Settings</div>
      <div class="modal-body">
        <div class="group">
          <h3>Appearance</h3>
          <div class="row">
            <label>Theme</label>
            <select
              value={settings().theme}
              onChange={(e) => setTheme(e.currentTarget.value as ThemePreference)}
            >
              <option value="system">Follow system</option>
              <option value="light">Light</option>
              <option value="dark">Dark</option>
            </select>
          </div>
          <div class="row">
            <label>High contrast</label>
            <div
              class="toggle"
              classList={{ on: settings().highContrast }}
              onClick={() => void ctx.saveSettingsPatch({ highContrast: !settings().highContrast })}
              role="switch"
              aria-checked={settings().highContrast}
              tabIndex={0}
              onKeyDown={(e) => e.key === 'Enter' || e.key === ' ' ? (e.preventDefault(), void ctx.saveSettingsPatch({ highContrast: !settings().highContrast })) : null}
            />
          </div>
        </div>

        <div class="group">
          <h3>Subscriptions</h3>
          <div class="row">
            <label>OPML export</label>
            <button class="btn" onClick={() => void triggerExport()}>Export…</button>
          </div>
          <div class="row">
            <label>OPML import (merge)</label>
            <button class="btn" onClick={() => triggerImport()}>Import…</button>
            <input
              id="opml-file-input"
              class="visually-hidden"
              type="file"
              accept=".opml,.xml,text/xml,application/xml"
              onChange={(e) => void onFileChosen(e)}
            />
          </div>
        </div>

        <Show when={ctx.mcpAvailable()}>
          <div class="group">
            <h3>MCP Server</h3>
            <div class="row">
              <label>Enable MCP</label>
              <div
                class="toggle"
                classList={{ on: settings().mcpEnabled }}
                onClick={() => void ctx.saveSettingsPatch({ mcpEnabled: !settings().mcpEnabled })}
                role="switch"
                aria-checked={settings().mcpEnabled}
                tabIndex={0}
                onKeyDown={(e) => e.key === 'Enter' || e.key === ' ' ? (e.preventDefault(), void ctx.saveSettingsPatch({ mcpEnabled: !settings().mcpEnabled })) : null}
              />
            </div>
            <Show when={settings().mcpEnabled}>
              <McpUrlBar />
            </Show>
          </div>
        </Show>

        <Show when={syncAvail()}>
          <SyncSection />
        </Show>

      </div>
      <div class="modal-footer">
        <span style={{ color: "var(--overlay)", "margin-right": "auto" }}>v{version}</span>
        <button class="btn primary" onClick={() => ctx.closeModal()}>Done</button>
      </div>
    </div>
  );
}

function SyncSection() {
  const ctx = useApp();
  const [code, setCode] = createSignal<string | null>(null);
  const [expiresAt, setExpiresAt] = createSignal<number | null>(null);
  const [copied, setCopied] = createSignal(false);
  const [pairInput, setPairInput] = createSignal('');
  const [pairError, setPairError] = createSignal<string | null>(null);
  const [busy, setBusy] = createSignal(false);
  const enabled = () => Boolean(ctx.syncKey());

  const generateCode = async () => {
    setBusy(true);
    try {
      const res = await issueOtp();
      setCode(res.code);
      setExpiresAt(res.expiresAt);
    } catch {
      setCode(null);
      setExpiresAt(null);
    } finally {
      setBusy(false);
    }
  };

  const copyCode = async () => {
    if (!code()) return;
    await navigator.clipboard.writeText(code()!);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const doPair = async () => {
    const v = pairInput().trim();
    if (!v) return;
    if (v.length !== 8) {
      setPairError('Enter an 8-character pairing code');
      return;
    }
    setBusy(true);
    setPairError(null);
    try {
      const key = await redeemCode(v);
      await ctx.pairSyncWithKey(key);
      setPairInput('');
    } catch (e) {
      setPairError(e instanceof Error ? e.message : 'Pairing failed');
    } finally {
      setBusy(false);
    }
  };

  const toggleOn = async () => {
    await ctx.enableSync();
  };

  const toggleOff = () => {
    void ctx.disableSync();
    setCode(null);
    setExpiresAt(null);
  };

  return (
    <div class="group">
      <h3>Sync</h3>
      <div class="row">
        <label>Enable sync</label>
        <div
          class="toggle"
          classList={{ on: enabled() }}
          onClick={() => void (enabled() ? toggleOff() : toggleOn())}
          role="switch"
          aria-checked={enabled()}
          tabIndex={0}
          onKeyDown={(e) => e.key === 'Enter' || e.key === ' ' ? (e.preventDefault(), void (enabled() ? toggleOff() : toggleOn())) : null}
        />
      </div>
      <Show when={enabled()}>
        <p style={{ 'font-size': '13px', color: 'var(--subtext)', margin: '12px 0 6px' }}>
          Join existing sync
        </p>
        <div class="row" style={{ 'border-bottom': 0 }}>
          <form
            onSubmit={(e) => { e.preventDefault(); void doPair(); }}
            style={{ display: 'flex', gap: '6px', 'align-items': 'center', width: '100%' }}
          >
            <input
              type="text"
              value={pairInput()}
              onInput={(e) => setPairInput(e.currentTarget.value)}
              placeholder="Enter pairing code"
              autocomplete="off"
              autocorrect="off"
              autocapitalize="off"
              spellcheck={false}
              disabled={busy()}
              style={{ flex: 1, 'font-size': '13px', padding: '4px 6px', background: 'var(--surface)', color: 'var(--text)', border: '1px solid var(--hairline)', 'border-radius': '4px' }}
            />
            <button class="btn" disabled={busy() || !pairInput().trim()}>Pair</button>
          </form>
        </div>
        <Show when={pairError()}>
          <p class="error" style={{ margin: '4px 0 0', 'font-size': '13px' }}>{pairError()}</p>
        </Show>

        <p style={{ 'font-size': '13px', color: 'var(--subtext)', margin: '12px 0 6px' }}>
          Start syncing another device
        </p>
        <Show when={code()} fallback={
          <div class="row">
            <button class="btn" disabled={busy()} onClick={() => void generateCode()}>
              Generate code
            </button>
          </div>
        }>
          <div class="sync-grid">
            <div class="sync-grid__cell">
              <span class="sync-grid__label">Pairing code</span>
              <span class="sync-grid__code">{code()}</span>
              <span class="sync-grid__expiry">{expiresAt() && `valid for ${Math.ceil((expiresAt()! - Date.now()) / 60000)} min`}</span>
              <div style={{ display: 'flex', gap: '6px', 'justify-content': 'center' }}>
                <button class="sync-grid__copy" onClick={() => void copyCode()} aria-label="Copy pairing code">
                  {copied() ? <Check size={14} /> : <Copy size={14} />}
                  <span style={{ 'font-size': '12px' }}>Copy</span>
                </button>
                <button class="sync-grid__copy" onClick={() => void generateCode()} aria-label="Generate new pairing code">
                  <RefreshCw size={14} />
                  <span style={{ 'font-size': '12px' }}>Regenerate</span>
                </button>
              </div>
              <span class="sync-grid__hint">Enter this code on your other device</span>
            </div>
            <div class="sync-grid__cell">
              <span class="sync-grid__label">QR code</span>
              <div class="sync-grid__qr" innerHTML={renderSyncKeyQr(window.location.origin + '/?pair=' + code()!)} />
              <span class="sync-grid__hint">Open Sift on your other device and scan</span>
            </div>
          </div>
        </Show>
      </Show>
    </div>
  );
}

function McpUrlBar() {
  const [copied, setCopied] = createSignal(false);
  const mcpEndpoint = createMemo(() => `${window.location.protocol}//${window.location.host}/mcp`);
  const config = createMemo(() => JSON.stringify({
    mcpServers: {
      sift: {
        type: 'sse',
        url: mcpEndpoint(),
      },
    },
  }, null, 2));

  const handleCopy = () => {
    void navigator.clipboard.writeText(config());
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div class="mcp-url-bar">
      <span class="mcp-url-bar__url">{mcpEndpoint()}</span>
      <button class="mcp-url-bar__copy" onClick={handleCopy} aria-label="Copy MCP config">
        {copied() ? <Check size={14} /> : <Copy size={14} />}
      </button>
    </div>
  );
}