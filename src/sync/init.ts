/**
 * Boot/focus/online sync hooks.
 *
 * - `bootSync()` is called once on app boot. If `syncKey` is unset, no-op.
 *   If `lastSyncAt` is unset (fresh device), runs the first-time setup.
 *   Otherwise, runs a normal pull.
 * - `pullIfStale(thresholdMs)` runs a pull if the last successful pull
 *   was more than `thresholdMs` ago.
 * - `pullNow()` always pulls.
 */

import { runFirstTimeSetup, runPull } from './merge';
import { loadDirty, persistDirty, setOnOverflow } from './queue';
import { scheduleFlush } from './push';
import { getStoredSyncKey, getStoredLastSyncAt } from './key';

let lastPullAt = 0;

export async function bootSync(): Promise<void> {
  const key = await getStoredSyncKey();
  if (!key) return;
  await loadDirty();
  setOnOverflow(() => scheduleFlush());

  // Persist dirty on tab close / hide.
  const persist = () => {
    void persistDirty();
  };
  if (typeof window !== 'undefined') {
    window.addEventListener('beforeunload', persist);
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') persist();
    });
  }

  const lastSyncAt = await getStoredLastSyncAt();
  if (lastSyncAt == null) {
    await runFirstTimeSetup();
  } else {
    await runPull();
  }
  lastPullAt = Date.now();
}

export async function pullIfStale(thresholdMs: number): Promise<void> {
  if (Date.now() - lastPullAt < thresholdMs) return;
  const key = await getStoredSyncKey();
  if (!key) return;
  await runPull();
  lastPullAt = Date.now();
}

export async function pullNow(): Promise<void> {
  const key = await getStoredSyncKey();
  if (!key) return;
  await runPull();
  lastPullAt = Date.now();
}

/**
 * Triggers a fresh first-time setup (used when the user enables sync
 * mid-session with a key).
 */
export async function triggerFirstTime(): Promise<void> {
  const key = await getStoredSyncKey();
  if (!key) return;
  await loadDirty();
  setOnOverflow(() => scheduleFlush());
  await runFirstTimeSetup();
  lastPullAt = Date.now();
}
