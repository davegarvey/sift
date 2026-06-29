import { Show, For } from 'solid-js';
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

  const setMarkRead = (on: boolean) => {
    void ctx.saveSettingsPatch({ markReadOnScrollPast: on });
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
        </div>

        <div class="group">
          <h3>Behavior</h3>
          <div class="row">
            <label>Mark items read when I scroll past them</label>
            <button
              class={`toggle ${settings().markReadOnScrollPast ? 'on' : ''}`}
              onClick={() => setMarkRead(!settings().markReadOnScrollPast)}
              role="switch"
              aria-checked={settings().markReadOnScrollPast}
              aria-label="Mark items read when I scroll past them"
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

        <div class="group">
          <h3>About</h3>
          <p style={{ "font-size": "12px", color: "var(--subtext)", "line-height": "1.5" }}>
            Sift — a browser-first RSS reader. MIT licensed. Local-only storage.
          </p>
        </div>
      </div>
      <div class="modal-footer">
        <button class="btn primary" onClick={() => ctx.closeModal()}>Done</button>
      </div>
    </div>
  );
}