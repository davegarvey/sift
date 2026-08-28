/**
 * Server capability detection. Cached per page load (not across reloads)
 * so a server that comes online after a page load is detected on the
 * next page reload.
 */

export interface SyncCapabilities {
  sync: boolean;
  stats: boolean;
}

let cached: SyncCapabilities | null = null;

export async function getSyncCapabilities(fetchImpl: typeof fetch = fetch): Promise<SyncCapabilities> {
  if (cached !== null) return cached;
  try {
    const res = await fetchImpl('/sync/capabilities', { method: 'GET' });
    if (!res.ok) {
      cached = { sync: false, stats: false };
      return cached;
    }
    const body = (await res.json()) as { sync?: boolean; stats?: boolean };
    cached = { sync: body.sync === true, stats: body.stats === true };
    return cached;
  } catch {
    cached = { sync: false, stats: false };
    return cached;
  }
}

export async function isSyncAvailable(fetchImpl: typeof fetch = fetch): Promise<boolean> {
  return (await getSyncCapabilities(fetchImpl)).sync;
}

export async function isStatsSyncAvailable(fetchImpl: typeof fetch = fetch): Promise<boolean> {
  const capabilities = await getSyncCapabilities(fetchImpl);
  return capabilities.sync && capabilities.stats;
}

export function resetSyncCapabilityCache(): void {
  cached = null;
}
