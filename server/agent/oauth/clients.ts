import type { Context } from 'hono';
import { fetchUpstreamWithPolicy, cancelResponse } from '../../fetch';
import { capBody, declaredLengthExceeds } from '../../body-cap';
import {
  METADATA_CACHE_SECONDS,
  limitByIp,
  noStore,
  nowSeconds,
  oauthError,
  parseRedirectUri,
  randomId,
  rateLimited,
  type OAuthContext,
} from './util';
import { RATE_LIMITS } from '../../sync/ratelimit';

export interface OAuthClient {
  clientId: string;
  name: string;
  redirectUris: string[];
  kind: 'registered' | 'metadata';
  clientUri: string | null;
}

const MAX_METADATA_BYTES = 64 * 1024;
const MAX_REGISTER_BYTES = 16 * 1024;
const MAX_REDIRECT_URIS = 10;
const NAME_MAX = 100;

interface ClientRow {
  client_id: string;
  client_name: string;
  redirect_uris: string;
  kind: string;
  expires_at: number | null;
  client_uri: string | null;
}

function toClient(row: ClientRow): OAuthClient {
  let redirectUris: string[] = [];
  try {
    const parsed: unknown = JSON.parse(row.redirect_uris);
    if (Array.isArray(parsed)) redirectUris = parsed.filter((v): v is string => typeof v === 'string');
  } catch {
    redirectUris = [];
  }
  return {
    clientId: row.client_id,
    name: row.client_name,
    redirectUris,
    kind: row.kind === 'metadata' ? 'metadata' : 'registered',
    clientUri: row.client_uri,
  };
}

export function isMetadataClientId(clientId: string): boolean {
  if (clientId.length > 2048) return false;
  let url: URL;
  try {
    url = new URL(clientId);
  } catch {
    return false;
  }
  if (url.protocol !== 'https:' || url.hash || url.username || url.password) return false;
  if (url.pathname === '/' || url.pathname === '') return false;
  const rawPath = clientId.slice(clientId.indexOf('/', 8)).split('?')[0];
  if (rawPath.split('/').some((segment) => segment === '.' || segment === '..')) return false;
  return true;
}

function cleanName(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const name = [...raw].map((ch) => (ch.charCodeAt(0) < 32 || ch.charCodeAt(0) === 127 ? ' ' : ch)).join('').trim();
  return name === '' ? null : name.slice(0, NAME_MAX);
}

function cleanClientUri(raw: unknown): string | null {
  if (typeof raw !== 'string' || raw.length > 2048) return null;
  try {
    const url = new URL(raw);
    if (url.protocol !== 'https:' || url.username || url.password) return null;
    return url.toString();
  } catch {
    return null;
  }
}

function validRedirectUris(raw: unknown): string[] | null {
  if (!Array.isArray(raw) || raw.length === 0 || raw.length > MAX_REDIRECT_URIS) return null;
  const uris: string[] = [];
  for (const entry of raw) {
    if (typeof entry !== 'string' || !parseRedirectUri(entry)) return null;
    uris.push(entry);
  }
  return uris;
}

async function readCapped(response: Response, maxBytes: number): Promise<string | null> {
  if (declaredLengthExceeds(response.headers, maxBytes)) {
    void cancelResponse(response);
    return null;
  }
  try {
    return await new Response(capBody(response.body, maxBytes)).text();
  } catch {
    return null;
  }
}

async function fetchMetadataClient(ctx: OAuthContext, clientId: string): Promise<OAuthClient | null> {
  let response: Response;
  try {
    response = await fetchUpstreamWithPolicy(clientId, { headers: { Accept: 'application/json' } }, { db: ctx.db, route: 'discovery' });
  } catch {
    return null;
  }
  if (response.status < 200 || response.status >= 300) {
    void cancelResponse(response);
    return null;
  }
  const text = await readCapped(response, MAX_METADATA_BYTES);
  if (text === null) return null;
  let doc: unknown;
  try {
    doc = JSON.parse(text);
  } catch {
    return null;
  }
  if (!doc || typeof doc !== 'object' || Array.isArray(doc)) return null;
  const record = doc as Record<string, unknown>;
  if (record.client_id !== clientId) return null;
  const redirectUris = validRedirectUris(record.redirect_uris);
  if (!redirectUris) return null;
  const method = record.token_endpoint_auth_method;
  if (method !== undefined && method !== 'none') return null;
  const name = cleanName(record.client_name) ?? new URL(clientId).host;
  return { clientId, name, redirectUris, kind: 'metadata', clientUri: cleanClientUri(record.client_uri) };
}

export async function resolveClient(ctx: OAuthContext, clientId: string): Promise<OAuthClient | null> {
  const now = nowSeconds();
  if (!isMetadataClientId(clientId)) {
    const row = await ctx.db
      .prepare("SELECT client_id, client_name, redirect_uris, kind, expires_at, client_uri FROM oauth_clients WHERE client_id = ? AND kind = 'registered'")
      .bind(clientId)
      .first<ClientRow>();
    return row ? toClient(row) : null;
  }
  const cached = await ctx.db
    .prepare("SELECT client_id, client_name, redirect_uris, kind, expires_at, client_uri FROM oauth_clients WHERE client_id = ? AND kind = 'metadata'")
    .bind(clientId)
    .first<ClientRow>();
  if (cached && cached.expires_at !== null && cached.expires_at > now) return toClient(cached);
  const fetched = await fetchMetadataClient(ctx, clientId);
  if (!fetched) return null;
  await ctx.db
    .prepare(
      "INSERT INTO oauth_clients (client_id, client_name, redirect_uris, kind, created_at, expires_at, client_uri) VALUES (?, ?, ?, 'metadata', ?, ?, ?) " +
        'ON CONFLICT (client_id) DO UPDATE SET client_name = excluded.client_name, redirect_uris = excluded.redirect_uris, expires_at = excluded.expires_at, client_uri = excluded.client_uri',
    )
    .bind(clientId, fetched.name, JSON.stringify(fetched.redirectUris), now, now + METADATA_CACHE_SECONDS, fetched.clientUri)
    .run();
  return fetched;
}

export async function lookupClientName(ctx: OAuthContext, clientId: string): Promise<string> {
  const row = await ctx.db
    .prepare('SELECT client_name FROM oauth_clients WHERE client_id = ?')
    .bind(clientId)
    .first<{ client_name: string }>();
  if (row) return row.client_name;
  try {
    return new URL(clientId).host;
  } catch {
    return clientId.slice(0, NAME_MAX);
  }
}

function registrationError(c: Context, error: 'invalid_redirect_uri' | 'invalid_client_metadata', description: string): Response {
  return oauthError(c, error, description);
}

export function registerRoute(ctx: OAuthContext) {
  return async (c: Context): Promise<Response> => {
    await ctx.ready();
    const limited = await limitByIp(ctx, c, 'oauth:register', RATE_LIMITS.oauthRegister);
    if (limited !== null) return rateLimited(c, limited);

    const text = await c.req.text();
    if (text.length > MAX_REGISTER_BYTES) return registrationError(c, 'invalid_client_metadata', 'Request body is too large');
    let body: unknown;
    try {
      body = JSON.parse(text);
    } catch {
      return registrationError(c, 'invalid_client_metadata', 'Body must be JSON');
    }
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      return registrationError(c, 'invalid_client_metadata', 'Body must be a JSON object');
    }
    const meta = body as Record<string, unknown>;

    const method = meta.token_endpoint_auth_method;
    if (method !== undefined && method !== 'none') {
      return registrationError(c, 'invalid_client_metadata', 'Only public clients (token_endpoint_auth_method none) are supported');
    }
    if (meta.grant_types !== undefined) {
      const grants = meta.grant_types;
      if (!Array.isArray(grants) || !grants.includes('authorization_code') || grants.some((g) => g !== 'authorization_code' && g !== 'refresh_token')) {
        return registrationError(c, 'invalid_client_metadata', 'Unsupported grant_types');
      }
    }
    if (meta.response_types !== undefined) {
      const types = meta.response_types;
      if (!Array.isArray(types) || types.length === 0 || types.some((t) => t !== 'code')) {
        return registrationError(c, 'invalid_client_metadata', 'Unsupported response_types');
      }
    }
    if (meta.redirect_uris === undefined || !Array.isArray(meta.redirect_uris) || meta.redirect_uris.length === 0) {
      return registrationError(c, 'invalid_redirect_uri', 'At least one redirect URI is required');
    }
    const redirectUris = validRedirectUris(meta.redirect_uris);
    if (!redirectUris) {
      return registrationError(c, 'invalid_redirect_uri', 'Redirect URIs must be HTTPS or loopback HTTP without a fragment');
    }
    if (meta.client_name !== undefined && typeof meta.client_name !== 'string') {
      return registrationError(c, 'invalid_client_metadata', 'client_name must be a string');
    }
    const name = cleanName(meta.client_name) ?? 'Unnamed client';
    const clientUri = cleanClientUri(meta.client_uri);

    const clientId = `c_${randomId(18)}`;
    const issuedAt = nowSeconds();
    await ctx.db
      .prepare("INSERT INTO oauth_clients (client_id, client_name, redirect_uris, kind, created_at, expires_at, client_uri) VALUES (?, ?, ?, 'registered', ?, NULL, ?)")
      .bind(clientId, name, JSON.stringify(redirectUris), issuedAt, clientUri)
      .run();

    noStore(c);
    return c.json(
      {
        client_id: clientId,
        client_id_issued_at: issuedAt,
        client_name: name,
        redirect_uris: redirectUris,
        ...(clientUri ? { client_uri: clientUri } : {}),
        token_endpoint_auth_method: 'none',
        grant_types: ['authorization_code', 'refresh_token'],
        response_types: ['code'],
      },
      201,
    );
  };
}
