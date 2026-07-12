/**
 * Server capability detection. Cached per page load (not across reloads)
 * so a server that comes online after a page load is detected on the
 * next page reload.
 */

let cached: boolean | null = null;

export async function isSyncAvailable(fetchImpl: typeof fetch = fetch): Promise<boolean> {
  if (cached !== null) return cached;
  try {
    const res = await fetchImpl('/sync/capabilities', { method: 'GET' });
    if (!res.ok) {
      cached = false;
      return false;
    }
    const body = (await res.json()) as { sync?: boolean };
    cached = body.sync === true;
    return cached;
  } catch {
    cached = false;
    return false;
  }
}

export function resetSyncCapabilityCache(): void {
  cached = null;
}
