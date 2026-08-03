/**
 * Persistent, reactive sync status.
 *
 * Tracks the last successful pull and push, the pending dirty count, and the
 * last error (with its kind) so the UI can show whether sync is healthy,
 * stale, or failing. Pull and push are tracked separately: an error clears
 * only when the same kind of operation succeeds afterwards.
 */

import { createSignal } from 'solid-js';
import { getMeta, setMeta } from '../db/meta';
import { getDirty } from './queue';

const LAST_PULL_KEY = 'sync_last_pull_at';
const LAST_PUSH_KEY = 'sync_last_push_at';
const ERROR_KEY = 'sync_last_error';
const ERROR_KIND_KEY = 'sync_last_error_kind';
const ERROR_AT_KEY = 'sync_last_error_at';

export type SyncErrorKind = 'push' | 'pull';

const [lastPullAt, setLastPullAt] = createSignal<number | null>(null);
const [lastPushAt, setLastPushAt] = createSignal<number | null>(null);
const [pendingCount, setPendingCount] = createSignal(0);
const [lastError, setLastError] = createSignal<string | null>(null);
const [lastErrorKind, setLastErrorKind] = createSignal<SyncErrorKind | null>(null);
const [lastErrorAt, setLastErrorAt] = createSignal<number | null>(null);

export { lastPullAt, lastPushAt, pendingCount, lastError, lastErrorKind, lastErrorAt };

let persistTimer: ReturnType<typeof setTimeout> | null = null;

function schedulePersist(): void {
  if (persistTimer) clearTimeout(persistTimer);
  persistTimer = setTimeout(() => {
    persistTimer = null;
    void persist();
  }, 200);
}

async function persist(): Promise<void> {
  await setMeta(LAST_PULL_KEY, lastPullAt());
  await setMeta(LAST_PUSH_KEY, lastPushAt());
  await setMeta(ERROR_KEY, lastError());
  await setMeta(ERROR_KIND_KEY, lastErrorKind());
  await setMeta(ERROR_AT_KEY, lastErrorAt());
}

function clearError(): void {
  setLastError(null);
  setLastErrorKind(null);
  setLastErrorAt(null);
}

export async function loadStatus(): Promise<void> {
  const [pull, push, err, kind, errAt] = await Promise.all([
    getMeta<number | null>(LAST_PULL_KEY, null),
    getMeta<number | null>(LAST_PUSH_KEY, null),
    getMeta<string | null>(ERROR_KEY, null),
    getMeta<SyncErrorKind | null>(ERROR_KIND_KEY, null),
    getMeta<number | null>(ERROR_AT_KEY, null),
  ]);
  setLastPullAt(pull);
  setLastError(err);
  setLastErrorKind(kind);
  setLastErrorAt(errAt);
  refreshPending();
}

export function refreshPending(): void {
  setPendingCount(getDirty().length);
}

export function markPullSuccess(): void {
  setLastPullAt(Date.now());
  if (lastErrorKind() !== 'push') clearError();
  schedulePersist();
  refreshPending();
}

export function markPushSuccess(t: number): void {
  setLastPushAt(t);
  if (lastErrorKind() !== 'pull') clearError();
  schedulePersist();
  refreshPending();
}

export function markError(kind: SyncErrorKind, e: unknown): void {
  setLastError(e instanceof Error ? e.message : String(e));
  setLastErrorKind(kind);
  setLastErrorAt(Date.now());
  schedulePersist();
}
