import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from 'solid-js/web';
import { getDb } from '../src/db/open';
import { setStoredSyncKey } from '../src/sync/key';
import { ConnectPage } from '../src/connect/ConnectPage';
import type { RequestView } from '../src/connect/api';

const KEY = 'AbCdEfGhIjKlMnOpQrStUv';

function makeView(overrides: Partial<RequestView> = {}): RequestView {
  return {
    requestId: 'req1',
    status: 'pending',
    clientName: 'Test Agent',
    unverified: true,
    clientHost: 'client.example',
    redirectHost: 'client.example',
    scopes: ['read', 'write'],
    createdAt: Date.now(),
    expiresAt: Date.now() + 600_000,
    approvalCode: 'abcd2345',
    connection: { usable: false, createdAt: null },
    ...overrides,
  };
}

interface Call {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: string | null;
}

function mockFetch(views: RequestView[] | (() => RequestView), decision?: { status: number; body: unknown }) {
  const calls: Call[] = [];
  let index = 0;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({
        url,
        method: init?.method ?? 'GET',
        headers: (init?.headers ?? {}) as Record<string, string>,
        body: typeof init?.body === 'string' ? init.body : null,
      });
      if (url.endsWith('/decision')) {
        return new Response(JSON.stringify(decision?.body ?? { redirect: 'https://client.example/cb?code=x' }), { status: decision?.status ?? 200 });
      }
      const view = typeof views === 'function' ? views() : views[Math.min(index++, views.length - 1)];
      return new Response(JSON.stringify(view), { status: 200 });
    }),
  );
  return calls;
}

let dispose: (() => void) | undefined;

function mount(navigate = vi.fn(), pollMs = 20) {
  dispose = render(() => <ConnectPage requestId="req1" navigate={navigate} pollMs={pollMs} />, document.body);
  return navigate;
}

function button(label: string): HTMLButtonElement {
  const found = [...document.querySelectorAll('button')].find((b) => b.textContent?.includes(label));
  if (!found) throw new Error(`no button ${label}`);
  return found;
}

beforeEach(async () => {
  const db = await getDb();
  await db.clear('meta');
  document.body.innerHTML = '';
});

afterEach(() => {
  dispose?.();
  dispose = undefined;
  vi.unstubAllGlobals();
});

describe('consent page', () => {
  it('shows the client, access and link time for a usable connection and allows without a key', async () => {
    await setStoredSyncKey(KEY);
    const calls = mockFetch([makeView({ connection: { usable: true, createdAt: Date.now() } })]);
    const navigate = mount();
    await vi.waitFor(() => expect(document.body.textContent).toContain('Connect Test Agent to your Sift?'));
    const text = document.body.textContent ?? '';
    expect(text).toContain('unverified');
    expect(text).toContain('client.example');
    expect(text).toContain('Link created at');
    expect(text).toContain('Read your subscriptions, reading statistics and articles, and change your subscriptions and reading state');
    button('Allow').click();
    await vi.waitFor(() => expect(navigate).toHaveBeenCalledWith('https://client.example/cb?code=x'));
    const decision = calls.find((c) => c.url.endsWith('/decision'));
    expect(decision?.headers['X-Sync-Key']).toBeUndefined();
    expect(JSON.parse(decision?.body ?? '{}')).toEqual({ decision: 'approve' });
  });

  it('uses read-only wording for a read-only request', async () => {
    mockFetch([makeView({ scopes: ['read'], connection: { usable: true, createdAt: Date.now() } })]);
    mount();
    await vi.waitFor(() => expect(document.body.textContent).toContain('It cannot change anything'));
    expect(document.body.textContent).not.toContain('change your subscriptions');
  });

  it('sends the sync key held by this browser when there is no usable connection', async () => {
    await setStoredSyncKey(KEY);
    const calls = mockFetch([makeView()]);
    const navigate = mount();
    await vi.waitFor(() => expect(document.body.textContent).toContain('You are approving as the Sift account'));
    expect(document.body.textContent).not.toContain('abcd-2345');
    button('Allow').click();
    await vi.waitFor(() => expect(navigate).toHaveBeenCalled());
    expect(calls.find((c) => c.url.endsWith('/decision'))?.headers['X-Sync-Key']).toBe(KEY);
  });

  it('denies and follows the returned redirect', async () => {
    mockFetch([makeView({ connection: { usable: true, createdAt: Date.now() } })], { status: 200, body: { redirect: 'https://client.example/cb?error=access_denied' } });
    const navigate = mount();
    await vi.waitFor(() => expect(document.body.textContent).toContain('Deny'));
    button('Deny').click();
    await vi.waitFor(() => expect(navigate).toHaveBeenCalledWith('https://client.example/cb?error=access_denied'));
  });

  it('shows the approval code and polls until the app decides', async () => {
    let decided = false;
    let pendingPolls = 0;
    const calls = mockFetch(() => {
      if (decided) return makeView({ status: 'approved', approvalCode: undefined, redirect: 'https://client.example/cb?code=y' });
      pendingPolls++;
      return makeView();
    });
    const navigate = mount();
    await vi.waitFor(() => expect(document.body.textContent).toContain('abcd-2345'));
    expect(document.body.textContent).toContain('tap “Have an approval code?” and enter this code');
    expect(document.querySelector('.connect__qr svg')).not.toBeNull();
    expect(button('Copy code')).toBeTruthy();
    await vi.waitFor(() => expect(pendingPolls).toBeGreaterThanOrEqual(2), { timeout: 10_000 });
    decided = true;
    await vi.waitFor(() => expect(navigate).toHaveBeenCalledWith('https://client.example/cb?code=y'), { timeout: 10_000 });
    expect(calls.filter((c) => !c.url.endsWith('/decision')).length).toBeGreaterThanOrEqual(3);
  }, 30_000);

  it('refuses a redirect that is not a safe address', async () => {
    mockFetch([makeView(), makeView({ status: 'approved', redirect: 'javascript:alert(1)' })]);
    const navigate = mount();
    await vi.waitFor(() => expect(document.body.textContent).toContain('unexpected address'));
    expect(navigate).not.toHaveBeenCalled();
  });

  it('tells the user to restart from the agent when the request has expired', async () => {
    mockFetch([makeView({ status: 'expired', approvalCode: undefined })]);
    mount();
    await vi.waitFor(() => expect(document.body.textContent).toContain('Request expired'));
    expect(document.body.textContent).toContain('Restart the connection from your agent');
  });

  it('shows a denied request', async () => {
    mockFetch([makeView({ status: 'denied', approvalCode: undefined })]);
    mount();
    await vi.waitFor(() => expect(document.body.textContent).toContain('Connection denied'));
  });

  it('reports an unknown request', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ error: 'not_found' }), { status: 404 })));
    mount();
    await vi.waitFor(() => expect(document.body.textContent).toContain('Request not found'));
  });

  it('falls back to the code when the stored key is rejected', async () => {
    await setStoredSyncKey(KEY);
    mockFetch([makeView()], { status: 401, body: { error: 'unauthorized' } });
    mount();
    await vi.waitFor(() => expect(document.body.textContent).toContain('You are approving as'));
    button('Allow').click();
    await vi.waitFor(() => expect(document.body.textContent).toContain('abcd-2345'));
    expect(document.body.textContent).toContain('could not confirm your account');
  });
});
