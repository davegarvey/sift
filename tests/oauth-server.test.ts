import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { openNodeSqlite } from '../server/node-sqlite';
import { createSelfHostedDatabases } from '../server/sqlite-d1';
import { createApp } from '../server/handle';
import { runSyncCron } from '../server/sync/cron';
import { fetchUpstreamWithPolicy } from '../server/fetch';
import { sha256Hex } from '../server/sync/tokens';

vi.mock('../server/fetch', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../server/fetch')>()),
  fetchUpstreamWithPolicy: vi.fn(),
}));

const ORIGIN = 'http://localhost';
const REDIRECT = 'https://client.example/callback';
const KEY = 'oauthtestkey0000000001';
const OTHER_KEY = 'oauthtestkey0000000002';

const directories: string[] = [];
let db: D1Database;
let app: ReturnType<typeof createApp>;
let close: () => void;

async function setup(publicUrl?: string): Promise<void> {
  const directory = mkdtempSync(join(tmpdir(), 'sift-oauth-'));
  directories.push(directory);
  const databases = await createSelfHostedDatabases(directory, openNodeSqlite);
  db = databases.sync as unknown as D1Database;
  close = () => {
    databases.sync.connection.close?.();
    databases.poll.connection.close?.();
  };
  app = createApp({ db, publicUrl });
  for (const key of [KEY, OTHER_KEY]) {
    expect((await app.request('/sync/register', { method: 'POST', headers: { 'X-Sync-Key': key } })).status).toBe(204);
  }
}

beforeEach(async () => {
  vi.mocked(fetchUpstreamWithPolicy).mockReset();
  await setup();
});

afterEach(() => {
  close();
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

function b64url(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function pkce(): Promise<{ verifier: string; challenge: string }> {
  const verifier = b64url(crypto.getRandomValues(new Uint8Array(32)));
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
  return { verifier, challenge: b64url(new Uint8Array(digest)) };
}

async function registerClient(overrides: Record<string, unknown> = {}): Promise<string> {
  const res = await app.request('/oauth/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ client_name: 'Test Agent', redirect_uris: [REDIRECT], ...overrides }),
  });
  expect(res.status).toBe(201);
  return ((await res.json()) as { client_id: string }).client_id;
}

async function mintConnection(key = KEY): Promise<{ connectionId: string; url: string; expiresAt: number }> {
  const res = await app.request('/sync/connections', { method: 'POST', headers: { 'X-Sync-Key': key } });
  expect(res.status).toBe(200);
  return (await res.json()) as { connectionId: string; url: string; expiresAt: number };
}

interface AuthorizeInput {
  clientId: string;
  challenge: string;
  redirectUri?: string;
  extra?: Record<string, string>;
  path?: string;
  omit?: string[];
}

async function authorize(input: AuthorizeInput): Promise<Response> {
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: input.clientId,
    redirect_uri: input.redirectUri ?? REDIRECT,
    code_challenge: input.challenge,
    code_challenge_method: 'S256',
    state: 'st-1',
    ...input.extra,
  });
  for (const name of input.omit ?? []) params.delete(name);
  return app.request(`${input.path ?? '/oauth/authorize'}?${params}`);
}

function requestIdFrom(res: Response): string {
  expect(res.status).toBe(302);
  const location = new URL(res.headers.get('Location') ?? '');
  expect(location.pathname).toBe('/connect');
  return location.searchParams.get('request') ?? '';
}

interface RequestView {
  requestId: string;
  status: string;
  clientName: string;
  unverified: boolean;
  clientHost: string | null;
  redirectHost: string;
  scopes: string[];
  approvalCode?: string;
  connection: { usable: boolean; createdAt: number | null };
  redirect?: string;
}

async function viewRequest(id: string): Promise<RequestView> {
  const res = await app.request(`/oauth/requests/${id}`);
  expect(res.status).toBe(200);
  return (await res.json()) as RequestView;
}

async function decide(id: string, decision: string, headers: Record<string, string> = {}): Promise<Response> {
  return app.request(`/oauth/requests/${id}/decision`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify({ decision }),
  });
}

function codeFrom(redirect: string): { code: string; state: string | null } {
  const url = new URL(redirect);
  return { code: url.searchParams.get('code') ?? '', state: url.searchParams.get('state') };
}

async function tokenRequest(params: Record<string, string>): Promise<Response> {
  return app.request('/oauth/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(params),
  });
}

interface TokenResponse {
  access_token: string;
  refresh_token: string;
  token_type: string;
  expires_in: number;
  scope: string;
}

async function connectClient(options: { scope?: string; key?: string } = {}) {
  const clientId = await registerClient();
  const { verifier, challenge } = await pkce();
  const requestId = requestIdFrom(await authorize({ clientId, challenge, extra: options.scope ? { scope: options.scope } : {} }));
  const res = await decide(requestId, 'approve', { 'X-Sync-Key': options.key ?? KEY });
  expect(res.status).toBe(200);
  const { redirect } = (await res.json()) as { redirect: string };
  return { clientId, verifier, challenge, requestId, redirect, ...codeFrom(redirect) };
}

async function exchange(c: { clientId: string; verifier: string; code: string }, extra: Record<string, string> = {}): Promise<Response> {
  return tokenRequest({
    grant_type: 'authorization_code',
    code: c.code,
    client_id: c.clientId,
    redirect_uri: REDIRECT,
    code_verifier: c.verifier,
    ...extra,
  });
}

describe('metadata', () => {
  it('serves origin-level protected-resource and authorisation-server metadata', async () => {
    const resource = await (await app.request('/.well-known/oauth-protected-resource')).json();
    expect(resource).toMatchObject({ resource: `${ORIGIN}/mcp`, authorization_servers: [ORIGIN], scopes_supported: ['read', 'write'] });
    const server = (await (await app.request('/.well-known/oauth-authorization-server')).json()) as Record<string, unknown>;
    expect(server).toMatchObject({
      issuer: ORIGIN,
      authorization_endpoint: `${ORIGIN}/oauth/authorize`,
      token_endpoint: `${ORIGIN}/oauth/token`,
      registration_endpoint: `${ORIGIN}/oauth/register`,
      revocation_endpoint: `${ORIGIN}/oauth/revoke`,
      code_challenge_methods_supported: ['S256'],
      grant_types_supported: ['authorization_code', 'refresh_token'],
      token_endpoint_auth_methods_supported: ['none'],
      client_id_metadata_document_supported: true,
    });
  });

  it('serves per-connection metadata whose endpoints carry the connection ID', async () => {
    const { connectionId } = await mintConnection();
    const resource = await (await app.request(`/.well-known/oauth-protected-resource/mcp/c/${connectionId}`)).json();
    expect(resource).toMatchObject({
      resource: `${ORIGIN}/mcp/c/${connectionId}`,
      authorization_servers: [`${ORIGIN}/oauth/c/${connectionId}`],
    });
    const server = await (await app.request(`/.well-known/oauth-authorization-server/oauth/c/${connectionId}`)).json();
    expect(server).toMatchObject({
      issuer: `${ORIGIN}/oauth/c/${connectionId}`,
      authorization_endpoint: `${ORIGIN}/oauth/c/${connectionId}/authorize`,
      token_endpoint: `${ORIGIN}/oauth/c/${connectionId}/token`,
      registration_endpoint: `${ORIGIN}/oauth/c/${connectionId}/register`,
      revocation_endpoint: `${ORIGIN}/oauth/c/${connectionId}/revoke`,
    });
  });

  it('rejects a malformed connection ID in metadata paths', async () => {
    expect((await app.request('/.well-known/oauth-protected-resource/mcp/c/short')).status).toBe(404);
    expect((await app.request('/.well-known/oauth-authorization-server/oauth/c/short')).status).toBe(404);
  });

  it('uses PUBLIC_URL instead of the request origin', async () => {
    close();
    await setup('https://sift.example.com/ignored/path');
    const resource = await (await app.request('/.well-known/oauth-protected-resource')).json();
    expect(resource).toMatchObject({ resource: 'https://sift.example.com/mcp', authorization_servers: ['https://sift.example.com'] });
    const server = (await (await app.request('/.well-known/oauth-authorization-server')).json()) as { issuer: string; token_endpoint: string };
    expect(server.issuer).toBe('https://sift.example.com');
    expect(server.token_endpoint).toBe('https://sift.example.com/oauth/token');
    const minted = await mintConnection();
    expect(minted.url).toBe(`https://sift.example.com/mcp/c/${minted.connectionId}`);
    const clientId = await registerClient();
    const { challenge } = await pkce();
    const res = await authorize({ clientId, challenge });
    expect(res.headers.get('Location')).toMatch(/^https:\/\/sift\.example\.com\/connect\?request=/);
  });
});

describe('CORS', () => {
  it('allows cross-origin calls to metadata, registration, token and revocation', async () => {
    for (const path of ['/.well-known/oauth-protected-resource', '/.well-known/oauth-authorization-server', '/oauth/register', '/oauth/token', '/oauth/revoke']) {
      const pre = await app.request(path, {
        method: 'OPTIONS',
        headers: { Origin: 'https://app.example', 'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'content-type' },
      });
      expect(pre.status).toBe(204);
      expect(pre.headers.get('Access-Control-Allow-Origin')).toBe('*');
      expect(pre.headers.get('Access-Control-Allow-Credentials')).toBeNull();
    }
    const token = await app.request('/oauth/token', {
      method: 'POST',
      headers: { Origin: 'https://app.example', 'Content-Type': 'application/x-www-form-urlencoded' },
      body: 'grant_type=nope',
    });
    expect(token.headers.get('Access-Control-Allow-Origin')).toBe('*');
    const meta = await app.request('/.well-known/oauth-authorization-server', { headers: { Origin: 'https://app.example' } });
    expect(meta.headers.get('Access-Control-Allow-Origin')).toBe('*');
  });

  it('keeps sync and consent endpoints same-origin', async () => {
    const pre = await app.request('/sync/connections', {
      method: 'OPTIONS',
      headers: { Origin: 'https://evil.example', 'Access-Control-Request-Method': 'POST' },
    });
    expect(pre.status).toBe(403);
    const minted = await app.request('/sync/connections', { method: 'POST', headers: { 'X-Sync-Key': KEY, Origin: 'https://evil.example' } });
    expect(minted.headers.get('Access-Control-Allow-Origin')).toBeNull();
    const view = await app.request('/oauth/requests/nope', { headers: { Origin: 'https://evil.example' } });
    expect(view.headers.get('Access-Control-Allow-Origin')).toBeNull();
    const authorizeRes = await app.request('/oauth/authorize', { headers: { Origin: 'https://evil.example' } });
    expect(authorizeRes.headers.get('Access-Control-Allow-Origin')).toBeNull();
  });
});

describe('connection IDs', () => {
  it('mints a URL-safe single-use ID bound to the key with a ten-minute expiry', async () => {
    const before = Date.now();
    const minted = await mintConnection();
    expect(minted.connectionId).toMatch(/^[A-Za-z0-9_-]{32}$/);
    expect(minted.url).toBe(`${ORIGIN}/mcp/c/${minted.connectionId}`);
    expect(minted.expiresAt).toBeGreaterThanOrEqual(before + 10 * 60 * 1000 - 2000);
    expect(minted.expiresAt).toBeLessThanOrEqual(Date.now() + 10 * 60 * 1000 + 2000);
    const row = await db.prepare('SELECT sync_key, used_at FROM oauth_connections WHERE connection_id = ?').bind(minted.connectionId).first<{ sync_key: string; used_at: number | null }>();
    expect(row).toEqual({ sync_key: KEY, used_at: null });
  });

  it('requires the master key', async () => {
    expect((await app.request('/sync/connections', { method: 'POST' })).status).toBe(401);
    const { access_token } = await completeFlow();
    const res = await app.request('/sync/connections', { method: 'POST', headers: { Authorization: `Bearer ${access_token}` } });
    expect(res.status).toBe(401);
  });

  it('rate-limits minting per sync key', async () => {
    for (let i = 0; i < 20; i++) await mintConnection();
    const res = await app.request('/sync/connections', { method: 'POST', headers: { 'X-Sync-Key': KEY } });
    expect(res.status).toBe(429);
    expect(res.headers.get('Retry-After')).not.toBeNull();
    expect((await app.request('/sync/connections', { method: 'POST', headers: { 'X-Sync-Key': OTHER_KEY } })).status).toBe(200);
  });
});

async function completeFlow(scope?: string): Promise<TokenResponse> {
  const c = await connectClient({ scope });
  const res = await exchange(c);
  expect(res.status).toBe(200);
  return (await res.json()) as TokenResponse;
}

describe('registration', () => {
  it('registers a public client and stores client_uri', async () => {
    const res = await app.request('/oauth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ client_name: 'My Agent', redirect_uris: [REDIRECT], client_uri: 'https://client.example/about' }),
    });
    expect(res.status).toBe(201);
    expect(res.headers.get('Cache-Control')).toBe('no-store');
    const body = (await res.json()) as Record<string, unknown>;
    expect(body).toMatchObject({ client_name: 'My Agent', token_endpoint_auth_method: 'none', redirect_uris: [REDIRECT] });
    const row = await db.prepare('SELECT kind, client_uri, expires_at FROM oauth_clients WHERE client_id = ?').bind(body.client_id).first<Record<string, unknown>>();
    expect(row).toEqual({ kind: 'registered', client_uri: 'https://client.example/about', expires_at: null });
  });

  it('refuses confidential clients, missing, non-HTTPS and fragment redirect URIs', async () => {
    const post = (body: unknown) =>
      app.request('/oauth/register', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const confidential = await post({ redirect_uris: [REDIRECT], token_endpoint_auth_method: 'client_secret_basic' });
    expect(confidential.status).toBe(400);
    expect(((await confidential.json()) as { error: string }).error).toBe('invalid_client_metadata');
    for (const redirect_uris of [undefined, [], ['http://client.example/cb'], ['javascript:alert(1)'], ['data:text/html,x'], ['file:///etc/passwd'], ['cursor://app/cb#frag'], [`${REDIRECT}#frag`], ['not a url']]) {
      const res = await post({ client_name: 'x', redirect_uris });
      expect(res.status).toBe(400);
      expect(((await res.json()) as { error: string }).error).toBe('invalid_redirect_uri');
    }
    expect((await post({ client_name: 'x', redirect_uris: ['http://127.0.0.1:8123/cb', 'http://localhost/cb', 'http://[::1]:9/cb'] })).status).toBe(201);
  });

  it('accepts private-use scheme redirects and marks such clients unverified', async () => {
    const uris = ['cursor://anysphere.cursor-retrieval/oauth/callback', 'com.example.app:/cb'];
    const clientId = await registerClient({ redirect_uris: uris });
    const { challenge } = await pkce();
    for (const redirectUri of uris) {
      const view = await viewRequest(requestIdFrom(await authorize({ clientId, challenge, redirectUri })));
      expect(view.unverified).toBe(true);
      expect(view.redirectHost).toBe(redirectUri.startsWith('cursor') ? 'cursor://' : 'com.example.app://');
    }
    expect((await authorize({ clientId, challenge, redirectUri: 'cursor://anysphere.cursor-retrieval/other' })).status).toBe(400);
  });

  it('rate-limits registration per IP', async () => {
    for (let i = 0; i < 30; i++) await registerClient();
    const res = await app.request('/oauth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ redirect_uris: [REDIRECT] }),
    });
    expect(res.status).toBe(429);
  });
});

describe('client ID metadata documents', () => {
  const CLIENT_URL = 'https://agent.example/oauth/client.json';

  function serveDocument(doc: unknown, status = 200): void {
    vi.mocked(fetchUpstreamWithPolicy).mockImplementation(async () =>
      new Response(typeof doc === 'string' ? doc : JSON.stringify(doc), { status, headers: { 'Content-Type': 'application/json' } }),
    );
  }

  it('accepts a valid document, uses its name, caches it and stores client_uri', async () => {
    serveDocument({ client_id: CLIENT_URL, client_name: 'Doc Agent', redirect_uris: [REDIRECT], client_uri: 'https://agent.example/' });
    const { challenge } = await pkce();
    const requestId = requestIdFrom(await authorize({ clientId: CLIENT_URL, challenge }));
    expect(vi.mocked(fetchUpstreamWithPolicy)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(fetchUpstreamWithPolicy).mock.calls[0][2]).toMatchObject({ route: 'discovery' });
    const view = await viewRequest(requestId);
    expect(view).toMatchObject({ clientName: 'Doc Agent', unverified: false, clientHost: 'agent.example', redirectHost: 'client.example' });
    const row = await db.prepare('SELECT kind, expires_at, client_uri FROM oauth_clients WHERE client_id = ?').bind(CLIENT_URL).first<{ kind: string; expires_at: number; client_uri: string }>();
    expect(row?.kind).toBe('metadata');
    expect(row?.client_uri).toBe('https://agent.example/');
    expect((row?.expires_at ?? 0) - Math.floor(Date.now() / 1000)).toBeGreaterThan(23 * 3600);
    await authorize({ clientId: CLIENT_URL, challenge });
    expect(vi.mocked(fetchUpstreamWithPolicy)).toHaveBeenCalledTimes(1);
  });

  it('refetches once the cache has expired', async () => {
    serveDocument({ client_id: CLIENT_URL, client_name: 'Doc Agent', redirect_uris: [REDIRECT] });
    const { challenge } = await pkce();
    await authorize({ clientId: CLIENT_URL, challenge });
    await db.prepare('UPDATE oauth_clients SET expires_at = ? WHERE client_id = ?').bind(Math.floor(Date.now() / 1000) - 1, CLIENT_URL).run();
    await authorize({ clientId: CLIENT_URL, challenge });
    expect(vi.mocked(fetchUpstreamWithPolicy)).toHaveBeenCalledTimes(2);
  });

  it('shows an error page, not a redirect, for a mismatched client_id', async () => {
    serveDocument({ client_id: 'https://other.example/client.json', client_name: 'Doc Agent', redirect_uris: [REDIRECT] });
    const { challenge } = await pkce();
    const res = await authorize({ clientId: CLIENT_URL, challenge });
    expect(res.status).toBe(400);
    expect(res.headers.get('Location')).toBeNull();
    expect(res.headers.get('Content-Type')).toContain('text/html');
  });

  it('refuses documents that omit the redirect URI, are invalid or fail to load', async () => {
    const { challenge } = await pkce();
    serveDocument({ client_id: CLIENT_URL, redirect_uris: ['https://client.example/other'] });
    expect((await authorize({ clientId: CLIENT_URL, challenge })).status).toBe(400);
    serveDocument('not json');
    expect((await authorize({ clientId: CLIENT_URL, challenge })).status).toBe(400);
    serveDocument({ client_id: CLIENT_URL, redirect_uris: [REDIRECT], token_endpoint_auth_method: 'client_secret_post' });
    expect((await authorize({ clientId: CLIENT_URL, challenge })).status).toBe(400);
    serveDocument({ client_id: CLIENT_URL, redirect_uris: ['http://insecure.example/cb'] });
    expect((await authorize({ clientId: CLIENT_URL, challenge, redirectUri: 'http://insecure.example/cb' })).status).toBe(400);
    serveDocument({}, 404);
    expect((await authorize({ clientId: CLIENT_URL, challenge })).status).toBe(400);
    vi.mocked(fetchUpstreamWithPolicy).mockRejectedValue(new Error('blocked'));
    expect((await authorize({ clientId: CLIENT_URL, challenge })).status).toBe(400);
    expect(await db.prepare('SELECT COUNT(*) AS n FROM oauth_clients').first<number>('n')).toBe(1);
  });

  it('marks a metadata client unverified when it redirects to a private-use scheme', async () => {
    serveDocument({ client_id: CLIENT_URL, client_name: 'Editor', redirect_uris: ['cursor://app/cb', REDIRECT] });
    const { challenge } = await pkce();
    const custom = await viewRequest(requestIdFrom(await authorize({ clientId: CLIENT_URL, challenge, redirectUri: 'cursor://app/cb' })));
    expect(custom).toMatchObject({ unverified: true, redirectHost: 'cursor://' });
    const web = await viewRequest(requestIdFrom(await authorize({ clientId: CLIENT_URL, challenge })));
    expect(web.unverified).toBe(false);
  });

  it('does not fetch URLs that are not valid metadata client IDs', async () => {
    const { challenge } = await pkce();
    for (const clientId of ['http://agent.example/c.json', 'https://agent.example/', 'https://agent.example/a/../c.json', 'https://u:p@agent.example/c.json']) {
      expect((await authorize({ clientId, challenge })).status).toBe(400);
    }
    expect(vi.mocked(fetchUpstreamWithPolicy)).not.toHaveBeenCalled();
  });
});

describe('authorisation request validation', () => {
  it('shows an error page for unknown clients and redirect mismatches without redirecting', async () => {
    const { challenge } = await pkce();
    const unknown = await authorize({ clientId: 'c_missing', challenge });
    expect(unknown.status).toBe(400);
    expect(unknown.headers.get('Location')).toBeNull();
    const clientId = await registerClient();
    for (const redirectUri of ['https://client.example/other', 'https://client.example/callback/', 'http://client.example/callback', 'https://evil.example/callback']) {
      const res = await authorize({ clientId, challenge, redirectUri });
      expect(res.status).toBe(400);
      expect(res.headers.get('Location')).toBeNull();
    }
    expect((await authorize({ clientId, challenge, omit: ['redirect_uri'] })).status).toBe(400);
    expect((await authorize({ clientId, challenge, omit: ['client_id'] })).status).toBe(400);
  });

  it('allows any port for loopback redirects but nothing else', async () => {
    const clientId = await registerClient({ redirect_uris: ['http://127.0.0.1/cb', 'http://localhost:1234/cb'] });
    const { challenge } = await pkce();
    expect((await authorize({ clientId, challenge, redirectUri: 'http://127.0.0.1:49152/cb' })).status).toBe(302);
    expect((await authorize({ clientId, challenge, redirectUri: 'http://localhost:9999/cb' })).status).toBe(302);
    expect((await authorize({ clientId, challenge, redirectUri: 'http://127.0.0.1:49152/other' })).status).toBe(400);
    expect((await authorize({ clientId, challenge, redirectUri: 'http://[::1]:49152/cb' })).status).toBe(400);
    expect((await authorize({ clientId, challenge, redirectUri: 'https://127.0.0.1:49152/cb' })).status).toBe(400);
    const exact = await registerClient({ redirect_uris: [REDIRECT] });
    expect((await authorize({ clientId: exact, challenge, redirectUri: 'https://client.example:8443/callback' })).status).toBe(400);
  });

  it('redirects other errors with the OAuth error and state', async () => {
    const clientId = await registerClient();
    const { challenge } = await pkce();
    const cases: Array<[Partial<AuthorizeInput>, string]> = [
      [{ extra: { response_type: 'token' } }, 'unsupported_response_type'],
      [{ omit: ['code_challenge'] }, 'invalid_request'],
      [{ extra: { code_challenge: 'short' } }, 'invalid_request'],
      [{ omit: ['code_challenge_method'] }, 'invalid_request'],
      [{ extra: { code_challenge_method: 'plain' } }, 'invalid_request'],
      [{ extra: { scope: 'read admin' } }, 'invalid_scope'],
      [{ extra: { resource: 'https://other.example/mcp' } }, 'invalid_target'],
      [{ extra: { resource: `${ORIGIN}/mcp/c/short` } }, 'invalid_target'],
    ];
    for (const [overrides, error] of cases) {
      const res = await authorize({ clientId, challenge, ...overrides });
      expect(res.status).toBe(302);
      const location = new URL(res.headers.get('Location') ?? '');
      expect(`${location.origin}${location.pathname}`).toBe(REDIRECT);
      expect(location.searchParams.get('error')).toBe(error);
      expect(location.searchParams.get('state')).toBe('st-1');
    }
    const noState = await authorize({ clientId, challenge, omit: ['state'] });
    expect(new URL(noState.headers.get('Location') ?? '').searchParams.get('error')).toBe('invalid_request');
    expect(await db.prepare('SELECT COUNT(*) AS n FROM oauth_requests').first<number>('n')).toBe(0);
  });

  it('creates a pending request with an approval code and sends the browser to the consent route', async () => {
    const clientId = await registerClient({ client_uri: 'https://client.example/' });
    const { challenge } = await pkce();
    const requestId = requestIdFrom(await authorize({ clientId, challenge }));
    expect(requestId).toMatch(/^[A-Za-z0-9_-]{43}$/);
    const view = await viewRequest(requestId);
    expect(view.status).toBe('pending');
    expect(view.approvalCode).toMatch(/^[abcdefghjkmnpqrstuvwxyz23456789]{8}$/);
    expect(view).toMatchObject({ clientName: 'Test Agent', unverified: true, clientHost: 'client.example', redirectHost: 'client.example', scopes: ['read', 'write'] });
    expect(view.connection).toEqual({ usable: false, createdAt: null });
    const row = await db.prepare('SELECT created_at, expires_at FROM oauth_requests WHERE request_id = ?').bind(requestId).first<{ created_at: number; expires_at: number }>();
    expect((row?.expires_at ?? 0) - (row?.created_at ?? 0)).toBe(600);
  });

  it('defaults scope to read write and keeps a read-only request read-only', async () => {
    const clientId = await registerClient();
    const { challenge } = await pkce();
    expect((await viewRequest(requestIdFrom(await authorize({ clientId, challenge })))).scopes).toEqual(['read', 'write']);
    expect((await viewRequest(requestIdFrom(await authorize({ clientId, challenge, extra: { scope: 'read' } })))).scopes).toEqual(['read']);
    expect((await viewRequest(requestIdFrom(await authorize({ clientId, challenge, extra: { scope: 'write read' } })))).scopes).toEqual(['read', 'write']);
    const full = await completeFlow();
    expect(full.scope).toBe('read write');
    const readOnly = await completeFlow('read');
    expect(readOnly.scope).toBe('read');
    const push = await app.request('/sync/push', {
      method: 'POST',
      headers: { Authorization: `Bearer ${readOnly.access_token}`, 'Content-Type': 'application/json' },
      body: '{}',
    });
    expect(push.status).toBe(403);
  });

  it('serves distinct approval codes across many requests', async () => {
    const clientId = await registerClient();
    const { challenge } = await pkce();
    for (let i = 0; i < 20; i++) requestIdFrom(await authorize({ clientId, challenge }));
    const distinct = await db.prepare('SELECT COUNT(DISTINCT approval_code) AS n FROM oauth_requests').first<number>('n');
    expect(distinct).toBe(20);
  });

  it('sends frame-ancestors none on the consent route', async () => {
    const res = await app.request('/connect?request=x');
    expect(res.headers.get('Content-Security-Policy')).toBe("frame-ancestors 'none'");
  });
});

describe('connection ID recovery and consent', () => {
  it('recovers the ID from the per-connection authorise path', async () => {
    const { connectionId } = await mintConnection();
    const clientId = await registerClient();
    const { challenge } = await pkce();
    const requestId = requestIdFrom(await authorize({ clientId, challenge, path: `/oauth/c/${connectionId}/authorize` }));
    const view = await viewRequest(requestId);
    expect(view.connection.usable).toBe(true);
    expect(view.connection.createdAt).toBeGreaterThan(0);
  });

  it('recovers the ID from the resource parameter on the origin-level endpoint', async () => {
    const { connectionId } = await mintConnection();
    const clientId = await registerClient();
    const { challenge } = await pkce();
    const requestId = requestIdFrom(await authorize({ clientId, challenge, extra: { resource: `${ORIGIN}/mcp/c/${connectionId}` } }));
    expect((await viewRequest(requestId)).connection.usable).toBe(true);
  });

  it('refuses a resource that disagrees with the path connection ID', async () => {
    const a = await mintConnection();
    const b = await mintConnection();
    const clientId = await registerClient();
    const { challenge } = await pkce();
    const res = await authorize({ clientId, challenge, path: `/oauth/c/${a.connectionId}/authorize`, extra: { resource: `${ORIGIN}/mcp/c/${b.connectionId}` } });
    expect(new URL(res.headers.get('Location') ?? '').searchParams.get('error')).toBe('invalid_target');
  });

  it('approves with the connection ID alone, consumes it, and binds the code to its account', async () => {
    const { connectionId } = await mintConnection(OTHER_KEY);
    const clientId = await registerClient();
    const { verifier, challenge } = await pkce();
    const requestId = requestIdFrom(await authorize({ clientId, challenge, path: `/oauth/c/${connectionId}/authorize` }));
    const res = await decide(requestId, 'approve');
    expect(res.status).toBe(200);
    const { redirect } = (await res.json()) as { redirect: string };
    const { code, state } = codeFrom(redirect);
    expect(redirect.startsWith(`${REDIRECT}?`)).toBe(true);
    expect(state).toBe('st-1');
    const used = await db.prepare('SELECT used_at FROM oauth_connections WHERE connection_id = ?').bind(connectionId).first<{ used_at: number | null }>();
    expect(used?.used_at).not.toBeNull();
    const stored = await db.prepare('SELECT sync_key, expires_at, created_at FROM oauth_codes WHERE code_hash = ?').bind(await sha256Hex(code)).first<{ sync_key: string; expires_at: number; created_at: number }>();
    expect(stored?.sync_key).toBe(OTHER_KEY);
    expect((stored?.expires_at ?? 0) - (stored?.created_at ?? 0)).toBe(60);
    expect(await db.prepare('SELECT COUNT(*) AS n FROM oauth_codes WHERE code_hash = ?').bind(code).first<number>('n')).toBe(0);

    const tokens = (await (await exchange({ clientId, verifier, code })).json()) as TokenResponse;
    const row = await db.prepare('SELECT sync_key FROM tokens WHERE token_hash = ?').bind(await sha256Hex(tokens.access_token)).first<{ sync_key: string }>();
    expect(row?.sync_key).toBe(OTHER_KEY);

    const second = requestIdFrom(await authorize({ clientId, challenge, path: `/oauth/c/${connectionId}/authorize` }));
    expect((await viewRequest(second)).connection.usable).toBe(false);
    expect((await decide(second, 'approve')).status).toBe(401);
  });

  it('consumes the connection ID only once under a second request', async () => {
    const { connectionId } = await mintConnection();
    const clientId = await registerClient();
    const { challenge } = await pkce();
    const first = requestIdFrom(await authorize({ clientId, challenge, path: `/oauth/c/${connectionId}/authorize` }));
    const second = requestIdFrom(await authorize({ clientId, challenge, path: `/oauth/c/${connectionId}/authorize` }));
    expect((await decide(first, 'approve')).status).toBe(200);
    expect((await decide(second, 'approve')).status).toBe(401);
    const stillPending = await viewRequest(second);
    expect(stillPending.status).toBe('pending');
  });

  it('lets only one of two concurrent approvals consume a connection ID', async () => {
    const { connectionId } = await mintConnection();
    const clientId = await registerClient();
    const { challenge } = await pkce();
    const ids = [
      requestIdFrom(await authorize({ clientId, challenge, path: `/oauth/c/${connectionId}/authorize` })),
      requestIdFrom(await authorize({ clientId, challenge, path: `/oauth/c/${connectionId}/authorize` })),
    ];
    const results = await Promise.all(ids.map((id) => decide(id, 'approve')));
    expect(results.map((r) => r.status).sort()).toEqual([200, 401]);
    expect(await db.prepare('SELECT COUNT(*) AS n FROM oauth_codes').first<number>('n')).toBe(1);
  });

  it('leaves the connection ID unused when the user denies', async () => {
    const { connectionId } = await mintConnection();
    const clientId = await registerClient();
    const { challenge } = await pkce();
    const requestId = requestIdFrom(await authorize({ clientId, challenge, path: `/oauth/c/${connectionId}/authorize` }));
    const res = await decide(requestId, 'deny');
    expect(res.status).toBe(200);
    const location = new URL(((await res.json()) as { redirect: string }).redirect);
    expect(`${location.origin}${location.pathname}`).toBe(REDIRECT);
    expect(location.searchParams.get('error')).toBe('access_denied');
    expect(location.searchParams.get('state')).toBe('st-1');
    const row = await db.prepare('SELECT used_at FROM oauth_connections WHERE connection_id = ?').bind(connectionId).first<{ used_at: number | null }>();
    expect(row?.used_at).toBeNull();
    expect(await db.prepare('SELECT COUNT(*) AS n FROM oauth_codes').first<number>('n')).toBe(0);
    expect((await viewRequest(requestId)).status).toBe('denied');
    const retry = requestIdFrom(await authorize({ clientId, challenge, path: `/oauth/c/${connectionId}/authorize` }));
    expect((await decide(retry, 'approve')).status).toBe(200);
  });

  it('refuses an expired connection ID', async () => {
    const { connectionId } = await mintConnection();
    const clientId = await registerClient();
    const { challenge } = await pkce();
    const requestId = requestIdFrom(await authorize({ clientId, challenge, path: `/oauth/c/${connectionId}/authorize` }));
    await db.prepare('UPDATE oauth_connections SET expires_at = ? WHERE connection_id = ?').bind(Math.floor(Date.now() / 1000) - 1, connectionId).run();
    expect((await viewRequest(requestId)).connection.usable).toBe(false);
    expect((await decide(requestId, 'approve')).status).toBe(401);
  });

  it('requires a usable connection ID or the master key to decide', async () => {
    const clientId = await registerClient();
    const { challenge } = await pkce();
    const requestId = requestIdFrom(await authorize({ clientId, challenge }));
    expect((await decide(requestId, 'approve')).status).toBe(401);
    expect((await decide(requestId, 'deny')).status).toBe(401);
    expect((await decide(requestId, 'approve', { 'X-Sync-Key': 'nonexistentkey0000000x' })).status).toBe(401);
    expect((await decide(requestId, 'maybe', { 'X-Sync-Key': KEY })).status).toBe(400);
    expect((await decide('missing', 'approve', { 'X-Sync-Key': KEY })).status).toBe(404);
    const { access_token } = await completeFlow();
    expect((await decide(requestId, 'approve', { Authorization: `Bearer ${access_token}` })).status).toBe(401);
    expect((await viewRequest(requestId)).status).toBe('pending');
  });

  it('refuses a second decision and an expired request', async () => {
    const clientId = await registerClient();
    const { challenge } = await pkce();
    const requestId = requestIdFrom(await authorize({ clientId, challenge }));
    expect((await decide(requestId, 'approve', { 'X-Sync-Key': KEY })).status).toBe(200);
    expect((await decide(requestId, 'approve', { 'X-Sync-Key': KEY })).status).toBe(409);
    expect((await decide(requestId, 'deny', { 'X-Sync-Key': KEY })).status).toBe(409);
    const stale = requestIdFrom(await authorize({ clientId, challenge }));
    await db.prepare('UPDATE oauth_requests SET expires_at = ? WHERE request_id = ?').bind(Math.floor(Date.now() / 1000) - 1, stale).run();
    expect((await viewRequest(stale)).status).toBe('expired');
    expect((await viewRequest(stale)).approvalCode).toBeUndefined();
    expect((await decide(stale, 'approve', { 'X-Sync-Key': KEY })).status).toBe(410);
  });

  it('approves in the same browser with the master key without consuming a connection ID', async () => {
    const { connectionId } = await mintConnection();
    const clientId = await registerClient();
    const { challenge } = await pkce();
    const requestId = requestIdFrom(await authorize({ clientId, challenge, path: `/oauth/c/${connectionId}/authorize` }));
    expect((await decide(requestId, 'approve', { 'X-Sync-Key': KEY })).status).toBe(200);
    const row = await db.prepare('SELECT used_at FROM oauth_connections WHERE connection_id = ?').bind(connectionId).first<{ used_at: number | null }>();
    expect(row?.used_at).toBeNull();
  });
});

describe('approval codes', () => {
  async function pendingWithCode() {
    const clientId = await registerClient({ client_uri: 'https://client.example/' });
    const pair = await pkce();
    const requestId = requestIdFrom(await authorize({ clientId, challenge: pair.challenge }));
    const view = await viewRequest(requestId);
    return { clientId, ...pair, requestId, code: view.approvalCode ?? '' };
  }

  const asKey = (key = KEY) => ({ 'X-Sync-Key': key });

  it('looks up a pending request by code with the master key only', async () => {
    const { code } = await pendingWithCode();
    expect((await app.request(`/oauth/approvals/${code}`)).status).toBe(401);
    const res = await app.request(`/oauth/approvals/${code.toUpperCase()}`, { headers: asKey() });
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body).toMatchObject({ status: 'pending', clientName: 'Test Agent', unverified: true, clientHost: 'client.example', redirectHost: 'client.example', scopes: ['read', 'write'] });
    expect(body.approvalCode).toBeUndefined();
    expect(body.redirect).toBeUndefined();
    expect((await app.request('/oauth/approvals/aaaaaaaa', { headers: asKey() })).status).toBe(404);
    expect((await app.request('/oauth/approvals/bad', { headers: asKey() })).status).toBe(404);
  });

  it('runs the approval-code flow end to end', async () => {
    const pending = await pendingWithCode();
    const res = await app.request(`/oauth/approvals/${pending.code}/decision`, {
      method: 'POST',
      headers: { ...asKey(OTHER_KEY), 'Content-Type': 'application/json' },
      body: JSON.stringify({ decision: 'approve' }),
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: 'approved' });

    const polled = await viewRequest(pending.requestId);
    expect(polled.status).toBe('approved');
    expect(polled.approvalCode).toBeUndefined();
    expect(polled.redirect).toBeDefined();
    const { code, state } = codeFrom(polled.redirect ?? '');
    expect(state).toBe('st-1');
    expect((await viewRequest(pending.requestId)).redirect).toBeUndefined();

    const tokens = await exchange({ clientId: pending.clientId, verifier: pending.verifier, code });
    expect(tokens.status).toBe(200);
    const { access_token } = (await tokens.json()) as TokenResponse;
    const row = await db.prepare('SELECT sync_key FROM tokens WHERE token_hash = ?').bind(await sha256Hex(access_token)).first<{ sync_key: string }>();
    expect(row?.sync_key).toBe(OTHER_KEY);

    const again = await app.request(`/oauth/approvals/${pending.code}/decision`, {
      method: 'POST',
      headers: { ...asKey(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ decision: 'approve' }),
    });
    expect(again.status).toBe(409);
  });

  it('delivers the access_denied redirect to the polling page once after an app denial', async () => {
    const pending = await pendingWithCode();
    const res = await app.request(`/oauth/approvals/${pending.code}/decision`, {
      method: 'POST',
      headers: { ...asKey(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ decision: 'deny' }),
    });
    expect(await res.json()).toEqual({ status: 'denied' });
    const polled = await viewRequest(pending.requestId);
    expect(polled.status).toBe('denied');
    const location = new URL(polled.redirect ?? '');
    expect(location.searchParams.get('error')).toBe('access_denied');
    expect(await db.prepare('SELECT COUNT(*) AS n FROM oauth_codes').first<number>('n')).toBe(0);
  });

  it('refuses an expired code', async () => {
    const pending = await pendingWithCode();
    await db.prepare('UPDATE oauth_requests SET expires_at = ? WHERE request_id = ?').bind(Math.floor(Date.now() / 1000) - 1, pending.requestId).run();
    const lookup = await app.request(`/oauth/approvals/${pending.code}`, { headers: asKey() });
    expect(((await lookup.json()) as { status: string }).status).toBe('expired');
    const res = await app.request(`/oauth/approvals/${pending.code}/decision`, {
      method: 'POST',
      headers: { ...asKey(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ decision: 'approve' }),
    });
    expect(res.status).toBe(410);
    expect(await db.prepare('SELECT COUNT(*) AS n FROM oauth_codes').first<number>('n')).toBe(0);
  });

  it('rate-limits lookups per sync key and per IP', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    try {
      vi.setSystemTime(Math.ceil(Date.now() / 60_000) * 60_000);
      const keys = [KEY, OTHER_KEY, 'oauthtestkey0000000003', 'oauthtestkey0000000004'];
      for (const key of keys.slice(2)) {
        await app.request('/sync/register', { method: 'POST', headers: { 'X-Sync-Key': key } });
      }
      for (let i = 0; i < 20; i++) expect((await app.request('/oauth/approvals/aaaaaaaa', { headers: asKey() })).status).toBe(404);
      const limited = await app.request('/oauth/approvals/aaaaaaaa', { headers: asKey() });
      expect(limited.status).toBe(429);
      expect(limited.headers.get('Retry-After')).not.toBeNull();
      for (const key of keys.slice(1, 3)) {
        for (let i = 0; i < 19; i++) expect((await app.request('/oauth/approvals/aaaaaaaa', { headers: asKey(key) })).status).toBe(404);
      }
      expect((await app.request('/oauth/approvals/aaaaaaaa', { headers: asKey(keys[3]) })).status).toBe(404);
      expect((await app.request('/oauth/approvals/aaaaaaaa', { headers: asKey(keys[3]) })).status).toBe(429);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('token endpoint', () => {
  it('requires form encoding and a known grant type', async () => {
    const json = await app.request('/oauth/token', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
    expect(json.status).toBe(400);
    expect(((await json.json()) as { error: string }).error).toBe('invalid_request');
    const unknown = await tokenRequest({ grant_type: 'password' });
    expect(((await unknown.json()) as { error: string }).error).toBe('unsupported_grant_type');
    const missing = await tokenRequest({ grant_type: 'authorization_code' });
    expect(((await missing.json()) as { error: string }).error).toBe('invalid_request');
  });

  it('issues tokens with the OAuth response shape and grant metadata', async () => {
    const c = await connectClient();
    const res = await exchange(c);
    expect(res.status).toBe(200);
    expect(res.headers.get('Cache-Control')).toBe('no-store');
    const body = (await res.json()) as TokenResponse;
    expect(body).toMatchObject({ token_type: 'Bearer', expires_in: 3600, scope: 'read write' });
    expect(body.access_token).toMatch(/^t[A-Za-z0-9_-]{22}$/);
    expect(body.refresh_token).toMatch(/^r[A-Za-z0-9_-]{43}$/);
    const row = await db
      .prepare('SELECT origin, client_id, client_name, scopes, family_id, refresh_hash, expires_at, refresh_expires_at, created_at FROM tokens WHERE token_hash = ?')
      .bind(await sha256Hex(body.access_token))
      .first<Record<string, number | string>>();
    expect(row).toMatchObject({ origin: 'oauth', client_id: c.clientId, client_name: 'Test Agent', scopes: 'read write', refresh_hash: await sha256Hex(body.refresh_token) });
    expect(row?.family_id).toBeTruthy();
    expect(Number(row?.expires_at) - Number(row?.created_at)).toBe(3600);
    expect(Number(row?.refresh_expires_at) - Number(row?.created_at)).toBe(365 * 24 * 3600);
    expect(await db.prepare('SELECT COUNT(*) AS n FROM tokens WHERE token_hash = ?').bind(body.access_token).first<number>('n')).toBe(0);
  });

  it('rejects a wrong PKCE verifier and invalidates the code', async () => {
    const c = await connectClient();
    const wrong = await exchange({ ...c, verifier: (await pkce()).verifier });
    expect(wrong.status).toBe(400);
    expect(((await wrong.json()) as { error: string }).error).toBe('invalid_grant');
    const retry = await exchange(c);
    expect(((await retry.json()) as { error: string }).error).toBe('invalid_grant');
    const short = await connectClient();
    expect((await exchange({ ...short, verifier: 'short' })).status).toBe(400);
  });

  it('rejects code replay', async () => {
    const c = await connectClient();
    expect((await exchange(c)).status).toBe(200);
    const replay = await exchange(c);
    expect(replay.status).toBe(400);
    expect(((await replay.json()) as { error: string }).error).toBe('invalid_grant');
  });

  it('rejects an expired code', async () => {
    const c = await connectClient();
    await db.prepare('UPDATE oauth_codes SET expires_at = ?').bind(Math.floor(Date.now() / 1000) - 1).run();
    const res = await exchange(c);
    expect(((await res.json()) as { error: string }).error).toBe('invalid_grant');
    expect(await db.prepare('SELECT COUNT(*) AS n FROM tokens').first<number>('n')).toBe(0);
  });

  it('rejects a different client or redirect URI', async () => {
    const c = await connectClient();
    const other = await registerClient();
    expect(((await (await exchange({ ...c, clientId: other })).json()) as { error: string }).error).toBe('invalid_grant');
    const d = await connectClient();
    const res = await tokenRequest({ grant_type: 'authorization_code', code: d.code, client_id: d.clientId, redirect_uri: 'https://client.example/other', code_verifier: d.verifier });
    expect(((await res.json()) as { error: string }).error).toBe('invalid_grant');
  });

  it('checks the resource parameter', async () => {
    const { connectionId } = await mintConnection();
    const clientId = await registerClient();
    const { verifier, challenge } = await pkce();
    const requestId = requestIdFrom(await authorize({ clientId, challenge, extra: { resource: `${ORIGIN}/mcp/c/${connectionId}` } }));
    const { redirect } = (await (await decide(requestId, 'approve', { 'X-Sync-Key': KEY })).json()) as { redirect: string };
    const { code } = codeFrom(redirect);
    const mismatch = await exchange({ clientId, verifier, code }, { resource: `${ORIGIN}/mcp` });
    expect(((await mismatch.json()) as { error: string }).error).toBe('invalid_target');

    const second = await connectClient();
    expect(((await (await exchange(second, { resource: 'https://other.example/mcp' })).json()) as { error: string }).error).toBe('invalid_target');

    const third = await connectClient();
    expect((await exchange(third, { resource: `${ORIGIN}/mcp` })).status).toBe(200);
  });

  it('refuses to issue tokens once the account key has been rotated away', async () => {
    const c = await connectClient();
    await db.prepare('UPDATE users SET rotated_at = ? WHERE sync_key = ?').bind(Math.floor(Date.now() / 1000), KEY).run();
    expect(((await (await exchange(c)).json()) as { error: string }).error).toBe('invalid_grant');
  });
});

describe('refresh tokens', () => {
  async function granted() {
    const c = await connectClient();
    const tokens = (await (await exchange(c)).json()) as TokenResponse;
    return { ...c, tokens };
  }

  function refresh(clientId: string, refreshToken: string, extra: Record<string, string> = {}): Promise<Response> {
    return tokenRequest({ grant_type: 'refresh_token', client_id: clientId, refresh_token: refreshToken, ...extra });
  }

  it('rotates tokens in place and invalidates the old pair', async () => {
    const g = await granted();
    const before = await db.prepare('SELECT token_id, family_id FROM tokens WHERE token_hash = ?').bind(await sha256Hex(g.tokens.access_token)).first<{ token_id: string; family_id: string }>();
    const res = await refresh(g.clientId, g.tokens.refresh_token);
    expect(res.status).toBe(200);
    const next = (await res.json()) as TokenResponse;
    expect(next.access_token).not.toBe(g.tokens.access_token);
    expect(next.refresh_token).not.toBe(g.tokens.refresh_token);
    expect(next.scope).toBe('read write');
    const after = await db.prepare('SELECT token_id, family_id, prev_refresh_hash FROM tokens WHERE token_hash = ?').bind(await sha256Hex(next.access_token)).first<{ token_id: string; family_id: string; prev_refresh_hash: string }>();
    expect(after).toEqual({ token_id: before?.token_id, family_id: before?.family_id, prev_refresh_hash: await sha256Hex(g.tokens.refresh_token) });
    expect(await db.prepare('SELECT COUNT(*) AS n FROM tokens').first<number>('n')).toBe(1);
    const pull = (token: string) => app.request('/sync/pull?since=0', { headers: { Authorization: `Bearer ${token}` } });
    expect((await pull(g.tokens.access_token)).status).toBe(401);
    expect((await pull(next.access_token)).status).toBe(200);
  });

  it('revokes the whole grant when a rotated refresh token is presented again', async () => {
    const g = await granted();
    const next = (await (await refresh(g.clientId, g.tokens.refresh_token)).json()) as TokenResponse;
    const reuse = await refresh(g.clientId, g.tokens.refresh_token);
    expect(reuse.status).toBe(400);
    expect(((await reuse.json()) as { error: string }).error).toBe('invalid_grant');
    expect(await db.prepare('SELECT COUNT(*) AS n FROM tokens').first<number>('n')).toBe(0);
    expect((await refresh(g.clientId, next.refresh_token)).status).toBe(400);
    expect((await app.request('/sync/pull?since=0', { headers: { Authorization: `Bearer ${next.access_token}` } })).status).toBe(401);
  });

  it('keeps the grant alive after months of inactivity and slides the window', async () => {
    const g = await granted();
    const stale = Math.floor(Date.now() / 1000) + 24 * 3600;
    await db.prepare('UPDATE tokens SET refresh_expires_at = ?').bind(stale).run();
    const res = await refresh(g.clientId, g.tokens.refresh_token);
    expect(res.status).toBe(200);
    const row = await db.prepare('SELECT refresh_expires_at FROM tokens').first<{ refresh_expires_at: number }>();
    expect((row?.refresh_expires_at ?? 0) - Math.floor(Date.now() / 1000)).toBeGreaterThan(364 * 24 * 3600);
  });

  it('rejects an expired refresh token and removes the grant', async () => {
    const g = await granted();
    await db.prepare('UPDATE tokens SET refresh_expires_at = ?').bind(Math.floor(Date.now() / 1000) - 1).run();
    expect(((await (await refresh(g.clientId, g.tokens.refresh_token)).json()) as { error: string }).error).toBe('invalid_grant');
    expect(await db.prepare('SELECT COUNT(*) AS n FROM tokens').first<number>('n')).toBe(0);
  });

  it('rejects another client, unknown tokens and scope escalation', async () => {
    const g = await granted();
    const other = await registerClient();
    expect((await refresh(other, g.tokens.refresh_token)).status).toBe(400);
    expect((await refresh(g.clientId, `r${'a'.repeat(43)}`)).status).toBe(400);
    expect((await refresh(g.clientId, 'garbage')).status).toBe(400);
    const readOnly = await connectClient({ scope: 'read' });
    const roTokens = (await (await exchange(readOnly)).json()) as TokenResponse;
    const escalate = await refresh(readOnly.clientId, roTokens.refresh_token, { scope: 'read write' });
    expect(((await escalate.json()) as { error: string }).error).toBe('invalid_scope');
    expect((await refresh(readOnly.clientId, roTokens.refresh_token, { scope: 'read' })).status).toBe(200);
  });

  it('revokes via /oauth/revoke using either token and always answers 200', async () => {
    const g = await granted();
    const revoke = (token: string, extra: Record<string, string> = {}) =>
      app.request('/oauth/revoke', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ token, ...extra }) });
    expect((await revoke('unknown')).status).toBe(200);
    expect((await revoke(g.tokens.access_token, { client_id: 'c_other' })).status).toBe(200);
    expect(await db.prepare('SELECT COUNT(*) AS n FROM tokens').first<number>('n')).toBe(1);
    expect((await revoke(g.tokens.refresh_token, { client_id: g.clientId })).status).toBe(200);
    expect(await db.prepare('SELECT COUNT(*) AS n FROM tokens').first<number>('n')).toBe(0);
    const h = await granted();
    expect((await revoke(h.tokens.access_token)).status).toBe(200);
    expect(await db.prepare('SELECT COUNT(*) AS n FROM tokens').first<number>('n')).toBe(0);
    expect((await refresh(h.clientId, h.tokens.refresh_token)).status).toBe(400);
  });

  it('does not let /oauth/revoke touch paired tokens', async () => {
    const mint = await app.request('/sync/tokens', { method: 'POST', headers: { 'X-Sync-Key': KEY } });
    const { code } = (await mint.json()) as { code: string };
    const redeem = await app.request('/sync/tokens/redeem', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code }) });
    const { token } = (await redeem.json()) as { token: string };
    await app.request('/oauth/revoke', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ token }) });
    expect((await app.request('/sync/pull?since=0', { headers: { Authorization: `Bearer ${token}` } })).status).toBe(200);
  });
});

describe('end to end', () => {
  it('registers, authorises with a connection URL, decides, exchanges and pulls', async () => {
    const minted = await mintConnection();
    const clientRes = await app.request(`/oauth/c/${minted.connectionId}/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ client_name: 'E2E Agent', redirect_uris: ['http://127.0.0.1/cb'] }),
    });
    expect(clientRes.status).toBe(201);
    const { client_id: clientId } = (await clientRes.json()) as { client_id: string };

    const { verifier, challenge } = await pkce();
    const authRes = await authorize({
      clientId,
      challenge,
      redirectUri: 'http://127.0.0.1:54321/cb',
      path: `/oauth/c/${minted.connectionId}/authorize`,
      extra: { scope: 'read write' },
    });
    const requestId = requestIdFrom(authRes);
    const view = await viewRequest(requestId);
    expect(view).toMatchObject({ clientName: 'E2E Agent', redirectHost: '127.0.0.1:54321' });
    expect(view.connection.usable).toBe(true);

    const decision = await decide(requestId, 'approve');
    const { redirect } = (await decision.json()) as { redirect: string };
    expect(redirect.startsWith('http://127.0.0.1:54321/cb?')).toBe(true);
    const { code, state } = codeFrom(redirect);
    expect(state).toBe('st-1');

    const tokenRes = await tokenRequest({
      grant_type: 'authorization_code',
      code,
      client_id: clientId,
      redirect_uri: 'http://127.0.0.1:54321/cb',
      code_verifier: verifier,
      resource: `${ORIGIN}/mcp/c/${minted.connectionId}`,
    });
    expect(tokenRes.status).toBe(200);
    const tokens = (await tokenRes.json()) as TokenResponse;

    const feedId = 'e2e-feed';
    const push = await app.request('/sync/push', {
      method: 'POST',
      headers: { Authorization: `Bearer ${tokens.access_token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ feeds: [{ feedId, feedUrl: 'https://example.com/feed.xml', title: 'E2E' }] }),
    });
    expect(push.status).toBe(204);

    const pull = await app.request('/sync/pull?since=0', { headers: { Authorization: `Bearer ${tokens.access_token}` } });
    expect(pull.status).toBe(200);
    const body = (await pull.json()) as { feeds: Array<{ feed_id: string }> };
    expect(body.feeds.map((f) => f.feed_id)).toContain(feedId);

    const listed = await app.request('/sync/tokens', { headers: { 'X-Sync-Key': KEY } });
    const { tokens: grants } = (await listed.json()) as { tokens: Array<{ origin: string; client_name: string; scopes: string }> };
    expect(grants).toEqual([expect.objectContaining({ origin: 'oauth', client_name: 'E2E Agent', scopes: 'read write' })]);
  });
});

describe('cleanup of registered clients', () => {
  const DAY = 24 * 3600;

  async function insertClient(id: string, kind: string, createdDaysAgo: number): Promise<void> {
    await db
      .prepare('INSERT INTO oauth_clients (client_id, client_name, redirect_uris, kind, created_at, expires_at) VALUES (?, ?, ?, ?, ?, NULL)')
      .bind(id, id, JSON.stringify([REDIRECT]), kind, Math.floor(Date.now() / 1000) - createdDaysAgo * DAY)
      .run();
  }

  it('deletes registered clients older than 30 days that nothing references', async () => {
    await insertClient('c_old_unused', 'registered', 31);
    await insertClient('c_old_token', 'registered', 90);
    await insertClient('c_old_request', 'registered', 90);
    await insertClient('c_recent', 'registered', 29);
    await insertClient('https://doc.example/client.json', 'metadata', 90);
    const now = Math.floor(Date.now() / 1000);
    await db
      .prepare("INSERT INTO tokens (token_id, token_hash, sync_key, scope, fingerprint, created_at, origin, client_id) VALUES ('t1', 'h1', ?, 'rw', 'FP', ?, 'oauth', 'c_old_token')")
      .bind(KEY, now)
      .run();
    await db
      .prepare("INSERT INTO oauth_requests (request_id, approval_code, client_id, redirect_uri, code_challenge, scopes, created_at, expires_at) VALUES ('r1', 'aaaaaaaa', 'c_old_request', ?, 'x', 'read', ?, ?)")
      .bind(REDIRECT, now, now + 600)
      .run();

    await runSyncCron(db, Date.now());

    const remaining = await db.prepare('SELECT client_id FROM oauth_clients ORDER BY client_id').all<{ client_id: string }>();
    expect(remaining.results.map((r) => r.client_id)).toEqual(['c_old_request', 'c_old_token', 'c_recent', 'https://doc.example/client.json']);
  });
});
