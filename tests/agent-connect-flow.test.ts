import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openNodeSqlite } from '../server/node-sqlite';
import { createSelfHostedDatabases } from '../server/sqlite-d1';
import { createApp } from '../server/handle';

const KEY = 'connectflowkey00000001';
const REDIRECT = 'https://client.example/callback';

let directory: string;
let close: () => void;
let app: ReturnType<typeof createApp>;

beforeEach(async () => {
  directory = mkdtempSync(join(tmpdir(), 'sift-connect-flow-'));
  const databases = await createSelfHostedDatabases(directory, openNodeSqlite);
  close = () => {
    databases.sync.connection.close?.();
    databases.poll.connection.close?.();
  };
  app = createApp({ db: databases.sync as unknown as D1Database, pollDb: databases.poll as unknown as D1Database });
  expect((await app.request('/sync/register', { method: 'POST', headers: { 'X-Sync-Key': KEY } })).status).toBe(204);
});

afterEach(() => {
  close();
  rmSync(directory, { recursive: true, force: true });
});

function b64url(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function json<T>(res: Response, status = 200): Promise<T> {
  expect(res.status).toBe(status);
  return (await res.json()) as T;
}

async function rpc(path: string, token: string, method: string, params?: unknown) {
  const res = await app.request(path, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  });
  return json<{ result?: Record<string, unknown>; error?: unknown }>(res);
}

describe('connection URL through to MCP tools', () => {
  it('mints a URL, completes OAuth via per-connection metadata and calls tools', async () => {
    const minted = await json<{ connectionId: string; url: string }>(
      await app.request('/sync/connections', { method: 'POST', headers: { 'X-Sync-Key': KEY } }),
    );
    const id = minted.connectionId;
    expect(minted.url).toBe(`http://localhost/mcp/c/${id}`);

    const unauthenticated = await app.request(`/mcp/c/${id}`, { method: 'POST', body: '{}' });
    expect(unauthenticated.status).toBe(401);
    expect(unauthenticated.headers.get('WWW-Authenticate')).toContain(`/.well-known/oauth-protected-resource/mcp/c/${id}`);

    const resource = await json<{ authorization_servers: string[] }>(
      await app.request(`/.well-known/oauth-protected-resource/mcp/c/${id}`),
    );
    const issuer = new URL(resource.authorization_servers[0]);
    const meta = await json<{
      authorization_endpoint: string;
      token_endpoint: string;
      registration_endpoint: string;
    }>(await app.request(`/.well-known/oauth-authorization-server${issuer.pathname}`));
    const path = (url: string) => new URL(url).pathname;

    const registered = await json<{ client_id: string }>(
      await app.request(path(meta.registration_endpoint), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ client_name: 'Flow Agent', redirect_uris: [REDIRECT], client_uri: 'https://client.example/home' }),
      }),
      201,
    );

    const verifier = b64url(crypto.getRandomValues(new Uint8Array(32)));
    const challenge = b64url(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))));
    const authorize = await app.request(
      `${path(meta.authorization_endpoint)}?${new URLSearchParams({
        response_type: 'code',
        client_id: registered.client_id,
        redirect_uri: REDIRECT,
        code_challenge: challenge,
        code_challenge_method: 'S256',
        state: 'flow-state',
      })}`,
    );
    expect(authorize.status).toBe(302);
    const consent = new URL(authorize.headers.get('Location') ?? '');
    expect(consent.pathname).toBe('/connect');
    const requestId = consent.searchParams.get('request') ?? '';

    const view = await json<{ connection: { usable: boolean }; clientName: string; clientHost: string | null }>(
      await app.request(`/oauth/requests/${requestId}`),
    );
    expect(view).toMatchObject({ clientName: 'Flow Agent', clientHost: 'client.example', connection: { usable: true } });

    const decision = await json<{ redirect: string }>(
      await app.request(`/oauth/requests/${requestId}/decision`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ decision: 'approve' }),
      }),
    );
    const redirect = new URL(decision.redirect);
    expect(redirect.searchParams.get('state')).toBe('flow-state');

    const exchange = (params: Record<string, string>) =>
      app.request(path(meta.token_endpoint), {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams(params),
      });
    const tokens = await json<{ access_token: string; refresh_token: string; scope: string }>(
      await exchange({
        grant_type: 'authorization_code',
        code: redirect.searchParams.get('code') ?? '',
        client_id: registered.client_id,
        redirect_uri: REDIRECT,
        code_verifier: verifier,
      }),
    );
    expect(tokens.scope).toBe('read write');

    const list = await rpc(`/mcp/c/${id}`, tokens.access_token, 'tools/list');
    const names = (list.result?.tools as Array<{ name: string }>).map((t) => t.name);
    expect(names).toContain('list_subscriptions');

    const called = await rpc(`/mcp/c/${id}`, tokens.access_token, 'tools/call', { name: 'list_subscriptions', arguments: {} });
    expect(called.error).toBeUndefined();
    expect((called.result as { isError?: boolean }).isError).toBeFalsy();

    const refreshed = await json<{ access_token: string; refresh_token: string }>(
      await exchange({ grant_type: 'refresh_token', refresh_token: tokens.refresh_token, client_id: registered.client_id }),
    );
    expect(refreshed.access_token).not.toBe(tokens.access_token);
    expect(refreshed.refresh_token).not.toBe(tokens.refresh_token);
    const again = await rpc(`/mcp/c/${id}`, refreshed.access_token, 'tools/call', { name: 'list_subscriptions', arguments: {} });
    expect(again.error).toBeUndefined();

    const listed = await json<{ tokens: Array<Record<string, unknown>> }>(
      await app.request('/sync/tokens', { headers: { 'X-Sync-Key': KEY } }),
    );
    expect(listed.tokens).toHaveLength(1);
    expect(listed.tokens[0]).toMatchObject({ client_name: 'Flow Agent', client_host: 'client.example', unverified: true, scopes: 'read write' });

    const reuse = await exchange({ grant_type: 'refresh_token', refresh_token: tokens.refresh_token, client_id: registered.client_id });
    expect(reuse.status).toBe(400);

    const spent = await json<{ connection: { usable: boolean } }>(await app.request(`/oauth/requests/${requestId}`));
    expect(spent.connection.usable).toBe(false);
  });
});
