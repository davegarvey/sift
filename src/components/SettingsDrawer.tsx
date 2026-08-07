import { Check, Copy } from 'lucide-solid';
import { version } from '../../package.json';
import { Show, createSignal, createMemo, createEffect, onMount, onCleanup } from 'solid-js';
import { useApp } from '../state';
import type { ThemePreference } from '../db/types';
import { serializeOpml } from '../opml/serialize';
import { parseOpml } from '../opml/parse';
import { buildMergePreview, applyMerge } from '../opml/merge';
import { isSyncAvailable } from '../sync/capabilities';
import { fingerprintSyncKey } from '../sync/key';
import { lastPullAt, lastPushAt, pendingCount, lastError, lastErrorAt } from '../sync/status';
import { humanRelativeTime } from '../util/time';

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
  const [fingerprint, setFingerprint] = createSignal<string | null>(null);
  const [copied, setCopied] = createSignal(false);
  const [syncing, setSyncing] = createSignal(false);
  const [confirmRegen, setConfirmRegen] = createSignal(false);
  const enabled = () => Boolean(ctx.syncKey());

  createEffect(() => {
    const key = ctx.syncKey();
    if (!key) {
      setFingerprint(null);
      return;
    }
    void fingerprintSyncKey(key).then(setFingerprint).catch(() => setFingerprint(null));
  });

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

  const copyFingerprint = async () => {
    const fp = fingerprint();
    if (!fp) return;
    await navigator.clipboard.writeText(fp);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const syncNow = async () => {
    setSyncing(true);
    try {
      await ctx.syncNow();
    } catch {
      // The status store records the failure; nothing else to surface here.
    } finally {
      setSyncing(false);
    }
  };

  const regenerate = async () => {
    if (!confirmRegen()) {
      setConfirmRegen(true);
      setTimeout(() => setConfirmRegen(false), 3000);
      return;
    }
    setConfirmRegen(false);
    setSyncError(null);
    try {
      await ctx.regenerateSyncKey();
    } catch (e) {
      setSyncError(e instanceof Error ? e.message : 'Regeneration failed');
    }
  };

  // Recompute relative times while the drawer is open.
  const [nowTick, setNowTick] = createSignal(Date.now());
  onMount(() => {
    const t = setInterval(() => setNowTick(Date.now()), 30_000);
    onCleanup(() => clearInterval(t));
  });

  const lastActivity = () => Math.max(lastPullAt() ?? 0, lastPushAt() ?? 0);

  const statusLine = () => {
    void nowTick(); // recompute relative time when the 30s tick fires
    const err = lastError();
    const errAt = lastErrorAt();
    if (err && errAt) {
      return { text: `Sync failed ${humanRelativeTime(new Date(errAt))} — ${err}`, error: true };
    }
    const pending = pendingCount();
    if (pending > 0) {
      return { text: `${pending} change${pending === 1 ? '' : 's'} waiting to sync`, error: false };
    }
    const last = lastActivity();
    if (last === 0) return { text: 'Never synced', error: false };
    return { text: `Synced ${humanRelativeTime(new Date(last))}`, error: false };
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
          <label>
            <Show when={fingerprint()} fallback="Group">
              Group: {fingerprint()}
            </Show>
          </label>
          <Show when={fingerprint()}>
            <button class="sync-grid__copy" onClick={() => void copyFingerprint()} aria-label="Copy group fingerprint">
              {copied() ? <Check size={14} /> : <Copy size={14} />}
            </button>
          </Show>
        </div>
        <div class="row" style="border-top: 0">
          <label classList={{ error: statusLine().error }}>{statusLine().text}</label>
          <button class="btn" disabled={syncing()} onClick={() => void syncNow()}>
            {syncing() ? 'Syncing…' : 'Sync now'}
          </button>
        </div>
        <div class="row">
          <label>Pair this device with an existing sync</label>
          <button class="btn" onClick={() => ctx.openModal({ kind: 'sync-join' })}>Join</button>
        </div>
        <div class="row" style="border-top: 0">
          <label>
            <Show when={fingerprint()} fallback="Add another device to this sync">
              Add another device to group {fingerprint()}
            </Show>
          </label>
          <button class="btn" onClick={() => ctx.openModal({ kind: 'sync-share' })}>Invite</button>
        </div>
        <div class="row">
          <label>Agents (AI access to this sync)</label>
          <button class="btn" onClick={() => ctx.openModal({ kind: 'agents' })}>Manage</button>
        </div>
        <div class="row" style="border-top: 0">
          <label>Regenerate sync key — revokes every agent token; other devices must re-pair</label>
          <button
            class="btn"
            classList={{ 'btn-danger': confirmRegen() }}
            onClick={() => void regenerate()}
          >
            {confirmRegen() ? 'Confirm' : 'Regenerate'}
          </button>
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