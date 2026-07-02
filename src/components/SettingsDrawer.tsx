import { ExternalLink, Check, Copy } from 'lucide-solid';
import { version } from '../../package.json';
import { Show, For, createSignal, createMemo } from 'solid-js';
import { useApp, applyTheme } from '../state';
import type { ThemePreference } from '../db/types';
import { serializeOpml } from '../opml/serialize';
import { parseOpml } from '../opml/parse';
import { buildMergePreview, applyMerge } from '../opml/merge';

export function SettingsDrawer() {
  const ctx = useApp();
  const settings = ctx.settings;

  const setTheme = (theme: ThemePreference) => {
    applyTheme(theme);
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
              <option value="accessible">High contrast</option>
            </select>
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
              <input
                type="checkbox"
                checked={settings().mcpEnabled}
                onChange={(e) => void ctx.saveSettingsPatch({ mcpEnabled: e.currentTarget.checked })}
              />
            </div>
            <Show when={settings().mcpEnabled}>
              <div style={{ padding: "0 0 8px", "font-size": "12px", color: "var(--subtext)" }}>
                <div style={{ "margin-bottom": "4px" }}>
                  Endpoint: <code style={{ "font-size": "12px" }}>http://{window.location.host}/mcp</code>
                </div>
                <CopyMcpConfigButton />
              </div>
            </Show>
          </div>
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

function CopyMcpConfigButton() {
  const [copied, setCopied] = createSignal(false);
  const config = createMemo(() => JSON.stringify({
    mcpServers: {
      sift: {
        type: 'sse',
        url: `${window.location.protocol}//${window.location.host}/mcp`,
      },
    },
  }, null, 2));

  const handleCopy = () => {
    void navigator.clipboard.writeText(config());
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <button class="btn subtle" style={{ display: 'inline-flex', 'align-items': 'center', gap: '4px' }} onClick={handleCopy}>
      {copied() ? <Check size={12} /> : <Copy size={12} />}
      {copied() ? 'Copied!' : 'Copy MCP Config'}
    </button>
  );
}