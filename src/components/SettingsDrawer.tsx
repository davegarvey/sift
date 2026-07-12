import { ExternalLink, Check, Copy } from 'lucide-solid';
import { version } from '../../package.json';
import { Show, For, createSignal, createMemo } from 'solid-js';
import { useApp } from '../state';
import type { ThemePreference } from '../db/types';
import { serializeOpml } from '../opml/serialize';
import { parseOpml } from '../opml/parse';
import { buildMergePreview, applyMerge } from '../opml/merge';
import { isSyncAvailable } from '../sync/capabilities';
import { PairDeviceModal } from './PairDeviceModal';

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

        <div class="group">
          <h3>About</h3>
          <p style={{ color: "var(--subtext)", "line-height": "1.5" }}>
            Sift — a browser-first RSS reader. MIT licensed. Local-only storage.
          </p>
          <a href="https://github.com/davegarvey/sift" target="_blank" rel="noopener noreferrer"
             style={{ "line-height": "1.5" }}>
            View source on GitHub <ExternalLink size={12} />
          </a>
        </div>
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
  const [pairMode, setPairMode] = createSignal<'source' | 'receiver' | null>(null);
  const [confirmDisable, setConfirmDisable] = createSignal(false);

  const enabled = () => Boolean(ctx.syncKey());
  const lastSyncedDisplay = createMemo(() => {
    const last = ctx.settings().lastSyncAt;
    if (!last) return 'never';
    const sec = Math.floor((Date.now() - last) / 1000);
    if (sec < 60) return 'just now';
    if (sec < 3600) return `${Math.floor(sec / 60)}m ago`;
    if (sec < 86400) return `${Math.floor(sec / 3600)}h ago`;
    return `${Math.floor(sec / 86400)}d ago`;
  });

  const enable = async () => {
    await ctx.enableSync();
  };

  const disable = async () => {
    if (!confirm('Your other devices will stop syncing. Server data is kept until you generate a new key. Continue?')) return;
    await ctx.disableSync();
    setConfirmDisable(false);
  };

  const regenerate = async () => {
    if (!confirm('Generate a new sync key? Your other devices will stop syncing.')) return;
    await ctx.regenerateSyncKey();
  };

  return (
    <div class="group">
      <h3>Sync</h3>
      <p style={{ color: 'var(--subtext)', 'font-size': '13px', 'line-height': '1.5', margin: '0 0 8px' }}>
        Sync copies your subscriptions and read state between devices using a server-stored key.
        There is no account; if you lose the key, server data is not recoverable.
      </p>
      <Show
        when={enabled()}
        fallback={
          <div class="row">
            <button class="btn" onClick={() => void enable()}>
              Enable sync
            </button>
            <button class="btn subtle" onClick={() => setPairMode('receiver')}>
              Have a key? Pair…
            </button>
          </div>
        }
      >
        <div class="row">
          <label>Last synced</label>
          <span style={{ color: 'var(--subtext)' }}>{lastSyncedDisplay()}</span>
        </div>
        <div class="row">
          <button class="btn" onClick={() => void ctx.syncNow()}>Sync now</button>
          <button class="btn subtle" onClick={() => setPairMode('source')}>Pair device</button>
        </div>
        <div class="row">
          <button class="btn subtle" onClick={() => void regenerate()}>Regenerate key</button>
          <button class="btn danger" onClick={() => void disable()}>Disable sync</button>
        </div>
        <div style={{ 'font-size': '12px', color: 'var(--subtext)', 'line-height': '1.5' }}>
          Save your sync key somewhere safe (e.g., a password manager). If you lose it, server data is not recoverable.
        </div>
      </Show>
      <Show when={pairMode()}>
        <PairDeviceModal mode={pairMode()!} onClose={() => setPairMode(null)} />
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