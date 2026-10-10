import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { render } from 'solid-js/web';
import { ConnectPage } from '../src/connect/ConnectPage';
import { peekStoredSyncKey } from '../src/sync/peek';
import { setStoredSyncKey } from '../src/sync/key';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('consent page in a browser that has never run Sift', () => {
  it('creates no IndexedDB database, local storage or sync registration', async () => {
    const view = {
      requestId: 'req1',
      status: 'pending',
      clientName: 'Fresh Agent',
      unverified: true,
      clientHost: null,
      redirectHost: 'cursor://',
      scopes: ['read', 'write'],
      createdAt: Date.now(),
      expiresAt: Date.now() + 600_000,
      approvalCode: 'abcd2345',
      connection: { usable: false, createdAt: null },
    };
    const fetchMock = vi.fn(async (url: string) => new Response(JSON.stringify({ ...view, requestId: url }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    expect(await indexedDB.databases()).toEqual([]);

    const dispose = render(() => <ConnectPage requestId="req1" navigate={vi.fn()} pollMs={10_000} />, document.body);
    await vi.waitFor(() => expect(document.body.textContent).toContain('abcd-2345'));

    expect(await indexedDB.databases()).toEqual([]);
    expect(localStorage.length).toBe(0);
    expect(fetchMock.mock.calls.every(([url]) => url.startsWith('/oauth/requests/'))).toBe(true);
    dispose();
  });

  it('peeks at an existing key without writing', async () => {
    expect(await peekStoredSyncKey()).toBeNull();
    expect(await indexedDB.databases()).toEqual([]);
    await setStoredSyncKey('AbCdEfGhIjKlMnOpQrStUv');
    expect(await peekStoredSyncKey()).toBe('AbCdEfGhIjKlMnOpQrStUv');
  });
});
