import { Check, Copy, ExternalLink } from 'lucide-solid';
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
    ctx.openModal({
      kind: 'confirm',
      title: 'Import OPML',
      message: `Import ${preview.newSubscriptions.length} feeds?`,
      hint: `${preview.skipped} already subscribed, ${preview.total} total found`,
      confirmLabel: 'Import',
      returnTo: { kind: 'settings' },
      onConfirm: async () => {
        await applyMerge(preview);
        await ctx.reloadFeeds();
        void ctx.mcpNotifySync();
        void ctx.refreshAll();
      },
    });
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
        <span style={{ display: 'flex', 'align-items': 'center', gap: '6px', color: 'var(--overlay)', 'margin-right': 'auto' }}>
          <span>v{version}</span>
          <a
            href="https://github.com/davegarvey/sift"
            target="_blank"
            rel="noopener noreferrer"
            title="Sift on GitHub"
            aria-label="Sift on GitHub"
            style={{ display: 'inline-flex', color: 'var(--overlay)' }}
          >
            <ExternalLink size={14} />
          </a>
        </span>
        <button class="btn primary" onClick={() => ctx.closeModal()}>Done</button>
      </div>
    </div>
  );
}

function SyncSection() {
  const ctx = useApp();
  const [syncError, setSyncError] = createSignal<string | null>(null);
  const [fingerprint, setFingerprint] = createSignal<string | null>(null);
  const [syncing, setSyncing] = createSignal(false);
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
      setSyncError('Failed to enable sync');
    }
  };

  const toggleOff = () => {
    ctx.openModal({
      kind: 'confirm',
      title: 'Disable sync',
      message: 'Your other devices will stop syncing. Server data is kept until you generate a new key. Continue?',
      confirmLabel: 'Disable',
      danger: true,
      returnTo: { kind: 'settings' },
      onConfirm: async () => {
        await ctx.disableSync();
      },
    });
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

  const regenerate = () => {
    ctx.openModal({
      kind: 'confirm',
      title: 'Regenerate sync key',
      message: 'Agents will lose access. Other devices will need to pair again.',
      hint: 'If a device was lost or stolen, regenerating the key is the only way to revoke its access.',
      confirmLabel: 'Regenerate',
      danger: true,
      returnTo: { kind: 'settings' },
      onConfirm: async () => {
        setSyncError(null);
        try {
          await ctx.regenerateSyncKey();
        } catch (e) {
          console.error('Failed to regenerate sync key:', e);
          setSyncError('Failed to regenerate the key');
        }
      },
    });
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
      return { text: `Sync failed ${humanRelativeTime(new Date(errAt))}`, error: true, detail: err };
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
      </div>
        <Show when={!enabled()}>
          <p style={{ 'font-size': '14px', color: 'var(--subtext)', margin: '0 0 4px', 'line-height': '1.5' }}>
            Sync keeps your subscriptions and reading progress in step across your devices. There is no account. If you lose your key, the data on the server is gone.
          </p>
        </Show>
        <Show when={!enabled()}>
          <div class="row">
            <label>Join an existing sync</label>
            <button class="btn" onClick={() => ctx.openModal({ kind: 'pair-device' })}>Join</button>
          </div>
        </Show>
        <Show when={syncError()}>
          <p class="error">{syncError()}</p>
        </Show>
        <Show when={enabled()}>
          <div class="row">
            <label classList={{ error: statusLine().error }} title={statusLine().detail ?? undefined}>
              {statusLine().text}
            <Show when={fingerprint()}>
              <span style={{ 'font-size': '13px', color: 'var(--subtext)' }}> · Group {fingerprint()}</span>
            </Show>
          </label>
          <button class="btn" disabled={syncing()} onClick={() => void syncNow()}>
            {syncing() ? 'Syncing…' : 'Sync now'}
          </button>
        </div>
        <div class="row">
          <label>Pair another device</label>
          <button class="btn" onClick={() => ctx.openModal({ kind: 'pair-device' })}>Pair</button>
        </div>
        <div class="row">
          <label>Agent access</label>
          <button class="btn" onClick={() => ctx.openModal({ kind: 'agents' })}>Manage</button>
        </div>
        <div class="row danger">
          <label>Regenerate sync key</label>
          <button class="btn" onClick={regenerate}>Regenerate</button>
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