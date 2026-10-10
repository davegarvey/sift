const CODE_ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789';
const CODE_LENGTH = 8;

function clean(raw: string): string | null {
  const code = raw.toLowerCase().replace(/[\s-]/g, '');
  if (code.length !== CODE_LENGTH) return null;
  for (const ch of code) if (!CODE_ALPHABET.includes(ch)) return null;
  return code;
}

export function normaliseApprovalCode(raw: string): string | null {
  const text = raw.trim();
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(text)) {
    try {
      const url = new URL(text);
      for (const name of ['code', 'approval', 'approve']) {
        const value = url.searchParams.get(name);
        if (value) return clean(value);
      }
    } catch {
      return null;
    }
    return null;
  }
  return clean(text);
}

export function displayApprovalCode(code: string): string {
  return `${code.slice(0, 4)}-${code.slice(4)}`;
}

export interface AccessView {
  status: 'pending' | 'approved' | 'denied' | 'expired';
  clientName: string;
  unverified: boolean;
  clientHost: string | null;
  redirectHost: string;
  scopes: string[];
  createdAt: number;
  expiresAt: number;
}

export class AgentApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    public readonly retryAfter?: number,
  ) {
    super(code);
  }
}

export async function readApiError(res: Response): Promise<AgentApiError> {
  let code = 'error';
  try {
    const body = (await res.json()) as { error?: unknown };
    if (typeof body.error === 'string') code = body.error;
  } catch {
    code = res.status === 404 ? 'not_found' : 'error';
  }
  const retry = Number(res.headers.get('Retry-After'));
  return new AgentApiError(res.status, code, Number.isFinite(retry) && retry > 0 ? retry : undefined);
}

export function canWrite(scopes: string[]): boolean {
  return scopes.includes('write');
}

export function accessSummary(scopes: string[]): string {
  const read = scopes.includes('read');
  const write = scopes.includes('write');
  if (read && write) {
    return 'Read your subscriptions, reading statistics and articles, and change your subscriptions and reading state';
  }
  if (write) return 'Change your subscriptions and reading state';
  return 'Read your subscriptions, reading statistics and articles. It cannot change anything.';
}

export function accessLabel(scopes: string): string {
  return scopes.split(' ').includes('write') ? 'Read and change' : 'Read only';
}

export function isSafeRedirect(target: string): boolean {
  try {
    const { protocol } = new URL(target);
    return !['javascript:', 'data:', 'blob:', 'file:', 'vbscript:', 'about:'].includes(protocol);
  } catch {
    return false;
  }
}
