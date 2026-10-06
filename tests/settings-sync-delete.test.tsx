import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from 'solid-js/web';
import { getDb } from '../src/db/open';
import { setStoredSyncKey } from '../src/sync/key';
import { SettingsDrawer } from '../src/components/SettingsDrawer';
import type { AppContext } from '../src/state';

const contextRef = vi.hoisted(() => ({ value: null as AppContext | null }));

vi.mock('../src/state', () => ({
  useApp: () => {
    if (!contextRef.value) throw new Error('test context not set');
    return contextRef.value;
  },
}));

vi.mock('../src/sync/capabilities', () => ({
  isSyncAvailable: async () => true,
}));

const KEY = 'AbCdEfGhIjKlMnOpQrStUv';

type ModalKind = Parameters<AppContext['openModal']>[0];
type ConfirmModal = Extract<ModalKind, { kind: 'confirm' }>;

function makeContext() {
  const modals: ModalKind[] = [];
  const disableSync = vi.fn(async () => {});
  contextRef.value = {
    settings: () => ({ theme: 'system', highContrast: false, mcpEnabled: false, syncKey: KEY }),
    syncKey: () => KEY,
    mcpAvailable: () => false,
    feeds: () => [],
    openModal: (modal: ModalKind) => { modals.push(modal); },
    closeModal: () => {},
    disableSync,
    saveSettingsPatch: async () => {},
  } as unknown as AppContext;
  return { modals, disableSync };
}

function rowButton(label: string): HTMLButtonElement {
  const row = [...document.querySelectorAll('.row')].find((r) => r.textContent?.includes(label));
  const button = row?.querySelector('button');
  if (!button) throw new Error(`no button in row ${label}`);
  return button;
}

async function mountDrawer(): Promise<() => void> {
  const dispose = render(() => <SettingsDrawer />, document.body);
  await vi.waitFor(() => expect(document.body.textContent).toContain('Delete sync data'));
  return dispose;
}

beforeEach(async () => {
  const db = await getDb();
  await db.clear('meta');
  await setStoredSyncKey(KEY);
  document.body.innerHTML = '';
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('settings: delete sync data', () => {
  it('asks for confirmation that states the effect on other devices and local data', async () => {
    const { modals } = makeContext();
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const dispose = await mountDrawer();
    rowButton('Delete sync data').click();

    expect(modals).toHaveLength(1);
    const modal = modals[0] as ConfirmModal;
    expect(modal.kind).toBe('confirm');
    expect(modal.title).toBe('Delete sync data');
    expect(modal.danger).toBe(true);
    expect(modal.message).toContain('other paired devices will stop syncing');
    expect(modal.message).toContain('on this device is kept');
    expect(modal.returnTo).toEqual({ kind: 'settings' });
    expect(fetchMock).not.toHaveBeenCalled();
    dispose();
  });

  it('calls the API and then disables sync on confirmation', async () => {
    const { modals, disableSync } = makeContext();
    const order: string[] = [];
    const fetchMock = vi.fn(async () => {
      order.push('fetch');
      return new Response(null, { status: 204 });
    });
    disableSync.mockImplementation(async () => { order.push('disable'); });
    vi.stubGlobal('fetch', fetchMock);
    const dispose = await mountDrawer();
    rowButton('Delete sync data').click();

    await (modals[0] as ConfirmModal).onConfirm();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('/sync/account');
    expect(init.method).toBe('DELETE');
    expect(new Headers(init.headers).get('X-Sync-Key')).toBe(KEY);
    expect(disableSync).toHaveBeenCalledTimes(1);
    expect(order).toEqual(['fetch', 'disable']);
    dispose();
  });

  it('keeps sync on and shows an error when the server call fails', async () => {
    const { modals, disableSync } = makeContext();
    vi.stubGlobal('fetch', vi.fn(async () => new Response(null, { status: 500 })));
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const dispose = await mountDrawer();
    rowButton('Delete sync data').click();

    await (modals[0] as ConfirmModal).onConfirm();

    expect(disableSync).not.toHaveBeenCalled();
    await vi.waitFor(() => expect(document.body.textContent).toContain('Failed to delete sync data'));
    dispose();
  });
});

describe('settings: disable sync confirmation', () => {
  it('says server data is kept and points to the delete action', async () => {
    const { modals } = makeContext();
    vi.stubGlobal('fetch', vi.fn());
    const dispose = await mountDrawer();
    const row = [...document.querySelectorAll<HTMLElement>('.row')].find((r) => r.textContent?.includes('Enable sync'));
    row?.querySelector<HTMLElement>('.toggle')?.click();

    expect(modals).toHaveLength(1);
    const modal = modals[0] as ConfirmModal;
    expect(modal.title).toBe('Disable sync');
    expect(modal.message).toContain('stays on the server');
    expect(modal.message).toContain('Delete sync data');
    expect(modal.message).not.toContain('until you generate a new key');
    dispose();
  });
});
