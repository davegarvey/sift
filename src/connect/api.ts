import { AgentApiError, readApiError, type AccessView } from '../agents/approval';

export interface RequestView extends AccessView {
  requestId: string;
  approvalCode?: string;
  connection: { usable: boolean; createdAt: number | null };
  redirect?: string;
}

export async function fetchRequest(requestId: string): Promise<RequestView> {
  const res = await fetch(`/oauth/requests/${encodeURIComponent(requestId)}`, { cache: 'no-store' });
  if (!res.ok) throw await readApiError(res);
  return (await res.json()) as RequestView;
}

export async function decideRequest(requestId: string, decision: 'approve' | 'deny', syncKey?: string): Promise<string> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (syncKey) headers['X-Sync-Key'] = syncKey;
  const res = await fetch(`/oauth/requests/${encodeURIComponent(requestId)}/decision`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ decision }),
  });
  if (!res.ok) throw await readApiError(res);
  const body = (await res.json()) as { redirect?: unknown };
  if (typeof body.redirect !== 'string') throw new AgentApiError(502, 'invalid_response');
  return body.redirect;
}
