import { getStoredSyncKey } from '../sync/key';
import { AgentApiError, readApiError, type AccessView } from './approval';

async function requireKey(): Promise<string> {
  const key = await getStoredSyncKey();
  if (!key) throw new AgentApiError(401, 'no_sync_key');
  return key;
}

export async function lookupApproval(code: string): Promise<AccessView> {
  const key = await requireKey();
  const res = await fetch(`/oauth/approvals/${encodeURIComponent(code)}`, { headers: { 'X-Sync-Key': key }, cache: 'no-store' });
  if (!res.ok) throw await readApiError(res);
  return (await res.json()) as AccessView;
}

export async function decideApproval(code: string, decision: 'approve' | 'deny'): Promise<void> {
  const key = await requireKey();
  const res = await fetch(`/oauth/approvals/${encodeURIComponent(code)}/decision`, {
    method: 'POST',
    headers: { 'X-Sync-Key': key, 'Content-Type': 'application/json' },
    body: JSON.stringify({ decision }),
  });
  if (!res.ok) throw await readApiError(res);
}
