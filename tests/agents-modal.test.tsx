import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from 'solid-js/web';
import { getDb } from '../src/db/open';
import { setStoredSyncKey } from '../src/sync/key';
import { AgentsModal } from '../src/components/AgentsModal';
import type { AppContext } from '../src/state';

const contextRef = vi.hoisted(() => ({ value: null as AppContext | null }));

vi.mock('../src/state', () => ({
  useApp: () => {
    if (!contextRef.value) throw new Error('test context not set');
    return contextRef.value;
  },
}));

const KEY = 'AbCdEfGhIjKlMnOpQrStUv';

type ModalKind = Parameters<AppContext['openModal']>[0];
type ConfirmModal = Extract<ModalKind, { kind: 'confirm' }>;

interface Call {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: string | null;
}

const token = {
  token_id: 't1',
  fingerprint: 'AB12',
  scope: 'rw',
  origin: 'oauth',
  label: null as string | null,
  client_name: 'Test Agent' as string | null,
  client_host: 'client.example' as string | null,
  unverified: true,
  scopes: 'read write',
  created_at: Date.now() - 3 * 86_400_000,
  last_seen_at: null as number | null,
};

let calls: Call[];
let tokens: Array<typeof token>;
let writeText: ReturnType<typeof vi.fn>;
let dispose: (() => void) | undefined;
let modals: ModalKind[];

function respond(body: unknown, status = 200): Response {
  return new Response(status === 204 ? null : JSON.stringify(body), { status });
}

const pendingView = {
  status: 'pending',
  clientName: 'Approve Me',
  unverified: true,
  clientHost: null,
  redirectHost: 'cursor://',
  scopes: ['read'],
  createdAt: Date.now(),
  expiresAt: Date.now() + 600_000,
};

beforeEach(async () => {
  calls = [];
  modals = [];
  tokens = [];
  writeText = vi.fn(async () => {});
  vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText }, mediaDevices: undefined });
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      const call = {
        url,
        method: init?.method ?? 'GET',
        headers: (init?.headers ?? {}) as Record<string, string>,
        body: typeof init?.body === 'string' ? init.body : null,
      };
      calls.push(call);
      if (url === '/sync/connections') return respond({ connectionId: 'c1', url: 'https://sift.example/mcp/c/c1', expiresAt: Date.now() + 600_000 });
      if (url === '/sync/tokens' && call.method === 'GET') return respond({ tokens });
      if (url === '/sync/tokens') return respond(null, 204);
      if (url === '/oauth/approvals/abcd2345') return respond(pendingView);
      if (url === '/oauth/approvals/abcd2345/decision') return respond({ status: 'approved' });
      if (url.startsWith('/oauth/approvals/')) return respond({ error: 'not_found' }, 404);
      return respond({}, 404);
    }),
  );
  contextRef.value = {
    openModal: (modal: ModalKind) => { modals.push(modal); },
    closeModal: () => {},
  } as unknown as AppContext;
  const db = await getDb();
  await db.clear('meta');
  await setStoredSyncKey(KEY);
  document.body.innerHTML = '';
});

afterEach(() => {
  dispose?.();
  dispose = undefined;
  vi.unstubAllGlobals();
});

async function mount() {
  dispose = render(() => <AgentsModal />, document.body);
  await vi.waitFor(() => expect(calls.some((c) => c.url === '/sync/tokens')).toBe(true));
  await new Promise((resolve) => setTimeout(resolve, 0));
}

function button(label: string): HTMLButtonElement {
  const found = [...document.querySelectorAll('button')].find((b) => b.textContent?.includes(label) || b.getAttribute('aria-label')?.includes(label));
  if (!found) throw new Error(`no button ${label}`);
  return found;
}

function typeInto(input: HTMLInputElement, value: string) {
  input.value = value;
  input.dispatchEvent(new InputEvent('input', { bubbles: true }));
}

describe('Agents screen', () => {
  it('shows only the connect action and a quiet approval link when there are no agents', async () => {
    await mount();
    const text = document.body.textContent ?? '';
    expect(text).toContain('Connect an agent');
    expect(text).toContain('Have an approval code?');
    expect(document.querySelector('input[aria-label="Approval code"]')).toBeNull();
    expect(document.querySelector('.agents-row')).toBeNull();
    expect(text).not.toContain('siftctl');
    expect(text).not.toContain('/mcp');
    expect(document.querySelector('a[href="/openapi.json"]')).toBeNull();
    expect(document.querySelector('h3')).toBeNull();
  });

  it('mints a connection URL, copies it and shows the guidance and countdown', async () => {
    await mount();
    button('Connect an agent').click();
    await vi.waitFor(() => expect(document.body.textContent).toContain('https://sift.example/mcp/c/c1'));
    expect(writeText).toHaveBeenCalledWith('https://sift.example/mcp/c/c1');
    const mint = calls.find((c) => c.url === '/sync/connections');
    expect(mint?.method).toBe('POST');
    expect(mint?.headers['X-Sync-Key']).toBe(KEY);
    const text = document.body.textContent ?? '';
    expect(text).toContain('Copied. Paste it into your agent, then tap Allow.');
    expect(text).toContain('Expires in 10 min');
  });

  it('approves a connection by a pasted code, ignoring case, spaces and hyphens', async () => {
    await mount();
    button('Have an approval code?').click();
    typeInto(document.querySelector<HTMLInputElement>('input[aria-label="Approval code"]')!, ' ABCD-23 45 ');
    button('Look up').click();
    await vi.waitFor(() => expect(document.body.textContent).toContain('Approve Me'));
    const lookup = calls.find((c) => c.url === '/oauth/approvals/abcd2345');
    expect(lookup?.headers['X-Sync-Key']).toBe(KEY);
    expect(document.body.textContent).toContain('cursor://');
    expect(document.body.textContent).toContain('unverified');
    expect(document.body.textContent).toContain('It cannot change anything');
    button('Approve').click();
    await vi.waitFor(() => expect(document.body.textContent).toContain('Approve Me is now connected.'));
    const decision = calls.find((c) => c.url === '/oauth/approvals/abcd2345/decision');
    expect(JSON.parse(decision?.body ?? '{}')).toEqual({ decision: 'approve' });
  });

  it('reports an unknown code', async () => {
    await mount();
    button('Have an approval code?').click();
    typeInto(document.querySelector<HTMLInputElement>('input[aria-label="Approval code"]')!, 'zzzzzzzz');
    button('Look up').click();
    await vi.waitFor(() => expect(document.body.textContent).toContain('No request matches that code'));
  });

  it('renames an agent and restores the default with an empty value', async () => {
    tokens = [{ ...token }];
    await mount();
    await vi.waitFor(() => expect(document.body.textContent).toContain('Test Agent'));
    const detail = document.querySelector('.agents-row__detail')?.textContent ?? '';
    expect(detail).toBe('client.example · Not used yet');
    expect(document.body.textContent).not.toContain('AB12');
    button('Rename Test Agent').click();
    const input = document.querySelector<HTMLInputElement>('input[aria-label="Agent name"]')!;
    expect(input.maxLength).toBe(64);
    typeInto(input, '  Work laptop ');
    tokens = [{ ...token, label: 'Work laptop' }];
    button('Save name').click();
    await vi.waitFor(() => expect(calls.some((c) => c.method === 'PATCH')).toBe(true));
    expect(JSON.parse(calls.find((c) => c.method === 'PATCH')!.body ?? '{}')).toEqual({ tokenId: 't1', label: 'Work laptop' });

    await vi.waitFor(() => expect(document.body.textContent).toContain('Work laptop'));
    button('Rename Work laptop').click();
    typeInto(document.querySelector<HTMLInputElement>('input[aria-label="Agent name"]')!, '');
    button('Save name').click();
    await vi.waitFor(() => expect(calls.filter((c) => c.method === 'PATCH')).toHaveLength(2));
    expect(JSON.parse(calls.filter((c) => c.method === 'PATCH')[1].body ?? '{}')).toEqual({ tokenId: 't1', label: '' });
  });

  it('asks for confirmation before revoking', async () => {
    tokens = [{ ...token, label: 'Work laptop' }];
    await mount();
    await vi.waitFor(() => expect(document.body.textContent).toContain('Work laptop'));
    button('Revoke Work laptop').click();
    expect(calls.some((c) => c.method === 'DELETE')).toBe(false);
    expect(modals).toHaveLength(1);
    const modal = modals[0] as ConfirmModal;
    expect(modal.kind).toBe('confirm');
    expect(modal.danger).toBe(true);
    expect(modal.returnTo).toEqual({ kind: 'agents' });
    await modal.onConfirm();
    const del = calls.find((c) => c.method === 'DELETE');
    expect(JSON.parse(del?.body ?? '{}')).toEqual({ token_id: 't1' });
  });

  it('keeps the detail line to what identifies the agent', async () => {
    tokens = [{ ...token, label: 'Work laptop', unverified: false, scopes: 'read', last_seen_at: Date.now() - 2 * 3_600_000 }];
    await mount();
    await vi.waitFor(() => expect(document.body.textContent).toContain('Work laptop'));
    expect(document.querySelector('.agents-row__detail')?.textContent).toBe('Test Agent · Read only · Last used 2h ago');
  });

  it('labels legacy paired tokens', async () => {
    tokens = [{ ...token, origin: 'paired', client_name: null, client_host: null, unverified: false }];
    await mount();
    await vi.waitFor(() => expect(document.body.textContent).toContain('Paired token'));
  });
});
