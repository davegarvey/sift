import { baseUrl } from './config.js';

export class ApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
  ) {
    super(message);
  }
}

interface RequestOptions {
  method?: string;
  token?: string;
  body?: unknown;
}

async function request(path: string, opts: RequestOptions = {}): Promise<Response> {
  const headers: Record<string, string> = {};
  if (opts.token) headers['X-Sync-Key'] = opts.token;
  if (opts.body !== undefined) headers['Content-Type'] = 'application/json';
  return fetch(baseUrl() + path, {
    method: opts.method ?? 'GET',
    headers,
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });
}

export interface PullPayload {
  serverTime: number;
  feeds: Array<Record<string, unknown>>;
  flags: Array<Record<string, unknown>>;
}

export async function capabilities(): Promise<{ sync: boolean }> {
  const res = await request('/sync/capabilities');
  if (!res.ok) throw new ApiError(`Capabilities failed: ${res.status}`, res.status);
  return (await res.json()) as { sync: boolean };
}

export async function redeemToken(code: string): Promise<string> {
  const res = await request('/sync/tokens/redeem', {
    method: 'POST',
    body: { code },
  });
  if (res.status === 404) throw new ApiError('Code not found or expired', 404);
  if (res.status === 429) throw new ApiError('Rate limited — try again in a minute', 429);
  if (!res.ok) throw new ApiError(`Redeem failed: ${res.status}`, res.status);
  const body = (await res.json()) as { token: string };
  return body.token;
}

export async function pull(token: string, since = 0): Promise<PullPayload> {
  const res = await request(`/sync/pull?since=${encodeURIComponent(String(since))}`, { token });
  if (res.status === 401) throw new ApiError('Unauthorized — token revoked or invalid; run `siftctl pair` again', 401);
  if (res.status === 429) throw new ApiError('Rate limited — wait a moment and retry', 429);
  if (!res.ok) throw new ApiError(`Pull failed: ${res.status}`, res.status);
  return (await res.json()) as PullPayload;
}

export async function push(token: string, body: { feeds?: unknown[]; flags?: unknown[] }): Promise<void> {
  const res = await request('/sync/push', { method: 'POST', token, body });
  if (res.status === 401) throw new ApiError('Unauthorized — token revoked or invalid; run `siftctl pair` again', 401);
  if (res.status === 429) throw new ApiError('Rate limited — wait a moment and retry', 429);
  if (res.status === 400) {
    const errBody = (await res.json().catch(() => null)) as { error?: string } | null;
    throw new ApiError(errBody?.error ?? 'Bad request', 400);
  }
  if (!res.ok) throw new ApiError(`Push failed: ${res.status}`, res.status);
}
