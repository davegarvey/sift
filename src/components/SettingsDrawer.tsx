import { Check, Copy } from 'lucide-solid';
import { version } from '../../package.json';
import { Show, createSignal, createMemo } from 'solid-js';
import { useApp } from '../state';
import type { ThemePreference } from '../db/types';
import { serializeOpml } from '../opml/serialize';
import { parseOpml } from '../opml/parse';
import { buildMergePreview, applyMerge } from '../opml/merge';
import { isSyncAvailable } from '../sync/capabilities';

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
  const [syncError, setSyncError] = createSignal<string | null>(null);
  const enabled = () => Boolean(ctx.syncKey());

  const toggleOn = async () => {
    setSyncError(null);
    try {
      await ctx.enableSync();
    } catch (e) {
      console.error('Failed to enable sync:', e);
      setSyncError(e instanceof Error ? e.message : 'Failed to enable sync');
    }
  };

  const toggleOff = () => {
    void ctx.disableSync();
    setSyncError(null);
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
        <Show when={syncError()}>
          <p class="error" style={{ margin: '4px 0 0', 'font-size': '13px' }}>{syncError()}</p>
        </Show>
      </div>
      <Show when={enabled()}>
        <div class="row">
          <label>Pair this device</label>
          <button class="btn" onClick={() => ctx.openModal({ kind: 'sync-join' })}>Join</button>
        </div>
        <div class="row" style="border-top: 0">
          <label>Add another device</label>
          <button class="btn" onClick={() => ctx.openModal({ kind: 'sync-share' })}>Generate</button>
        </div>
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