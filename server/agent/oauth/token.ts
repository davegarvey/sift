import type { Context } from 'hono';
import { RATE_LIMITS } from '../../sync/ratelimit';
import { generateToken, generateTokenId, sha256Hex, tokenFingerprint } from '../../sync/tokens';
import { parseScopes } from '../../sync/auth';
import { lookupClientName } from './clients';
import {
  ACCESS_TOKEN_TTL_SECONDS,
  REFRESH_TOKEN_TTL_SECONDS,
  base64url,
  generateRefreshToken,
  isRefreshTokenFormat,
  limitByIp,
  noStore,
  nowSeconds,
  oauthError,
  origin,
  rateLimited,
  resourceConnectionId,
  usableUser,
  type OAuthContext,
} from './util';

const MAX_FORM_BYTES = 8 * 1024;
const VERIFIER_RE = /^[A-Za-z0-9\-._~]{43,128}$/;

async function readForm(c: Context): Promise<URLSearchParams | null> {
  const type = c.req.header('Content-Type') ?? '';
  if (!type.toLowerCase().startsWith('application/x-www-form-urlencoded')) return null;
  const text = await c.req.text();
  if (text.length > MAX_FORM_BYTES) return null;
  return new URLSearchParams(text);
}

async function pkceChallenge(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
  return base64url(new Uint8Array(digest));
}

function tokenResponse(c: Context, accessToken: string, refreshToken: string, scopes: string): Response {
  noStore(c);
  return c.json({
    access_token: accessToken,
    token_type: 'Bearer',
    expires_in: ACCESS_TOKEN_TTL_SECONDS,
    refresh_token: refreshToken,
    scope: scopes,
  });
}

interface CodeRow {
  client_id: string;
  redirect_uri: string;
  code_challenge: string;
  scopes: string;
  resource: string | null;
  sync_key: string;
  expires_at: number;
}

async function authorizationCodeGrant(ctx: OAuthContext, c: Context, form: URLSearchParams): Promise<Response> {
  const code = form.get('code');
  const clientId = form.get('client_id');
  const redirectUri = form.get('redirect_uri');
  const verifier = form.get('code_verifier');
  if (!code || !clientId || !redirectUri || !verifier) {
    return oauthError(c, 'invalid_request', 'code, client_id, redirect_uri and code_verifier are required');
  }
  const codeHash = await sha256Hex(code);
  const row = await ctx.db
    .prepare('SELECT client_id, redirect_uri, code_challenge, scopes, resource, sync_key, expires_at FROM oauth_codes WHERE code_hash = ?')
    .bind(codeHash)
    .first<CodeRow>();
  if (!row) return oauthError(c, 'invalid_grant', 'The authorisation code is invalid or already used');
  const consumed = await ctx.db.prepare('DELETE FROM oauth_codes WHERE code_hash = ?').bind(codeHash).run();
  if (consumed.meta.changes !== 1) return oauthError(c, 'invalid_grant', 'The authorisation code is invalid or already used');

  const now = nowSeconds();
  if (row.expires_at <= now) return oauthError(c, 'invalid_grant', 'The authorisation code has expired');
  if (row.client_id !== clientId) return oauthError(c, 'invalid_grant', 'The code was issued to a different client');
  if (row.redirect_uri !== redirectUri) return oauthError(c, 'invalid_grant', 'redirect_uri does not match the authorisation request');
  if (!VERIFIER_RE.test(verifier) || (await pkceChallenge(verifier)) !== row.code_challenge) {
    return oauthError(c, 'invalid_grant', 'PKCE verification failed');
  }
  const resource = form.get('resource');
  if (resource !== null) {
    if (!resourceConnectionId(resource, origin(c, ctx.publicUrl)).valid) return oauthError(c, 'invalid_target', 'resource must identify this Sift server');
    if (row.resource !== null && row.resource !== resource) return oauthError(c, 'invalid_target', 'resource does not match the authorisation request');
  }
  if (!(await usableUser(ctx.db, row.sync_key))) return oauthError(c, 'invalid_grant', 'The account is no longer available');

  const accessToken = generateToken();
  const refreshToken = generateRefreshToken();
  const clientName = await lookupClientName(ctx, clientId);
  await ctx.db
    .prepare(
      'INSERT INTO tokens (token_id, token_hash, sync_key, scope, fingerprint, created_at, origin, client_id, client_name, scopes, refresh_hash, refresh_expires_at, expires_at, family_id) ' +
        "VALUES (?, ?, ?, 'rw', ?, ?, 'oauth', ?, ?, ?, ?, ?, ?, ?)",
    )
    .bind(
      generateTokenId(),
      await sha256Hex(accessToken),
      row.sync_key,
      await tokenFingerprint(accessToken),
      now,
      clientId,
      clientName,
      row.scopes,
      await sha256Hex(refreshToken),
      now + REFRESH_TOKEN_TTL_SECONDS,
      now + ACCESS_TOKEN_TTL_SECONDS,
      generateTokenId(),
    )
    .run();
  return tokenResponse(c, accessToken, refreshToken, row.scopes);
}

interface GrantRow {
  token_id: string;
  sync_key: string;
  client_id: string | null;
  scopes: string;
  family_id: string | null;
  refresh_expires_at: number | null;
}

async function revokeFamily(ctx: OAuthContext, row: Pick<GrantRow, 'token_id' | 'family_id'>): Promise<void> {
  if (row.family_id) {
    await ctx.db.prepare('DELETE FROM tokens WHERE family_id = ?').bind(row.family_id).run();
  } else {
    await ctx.db.prepare('DELETE FROM tokens WHERE token_id = ?').bind(row.token_id).run();
  }
}

async function refreshGrant(ctx: OAuthContext, c: Context, form: URLSearchParams): Promise<Response> {
  const refresh = form.get('refresh_token');
  const clientId = form.get('client_id');
  if (!refresh || !clientId) return oauthError(c, 'invalid_request', 'refresh_token and client_id are required');
  if (!isRefreshTokenFormat(refresh)) return oauthError(c, 'invalid_grant', 'The refresh token is invalid');
  const refreshHash = await sha256Hex(refresh);
  const columns = 'token_id, sync_key, client_id, scopes, family_id, refresh_expires_at';
  const row = await ctx.db
    .prepare(`SELECT ${columns} FROM tokens WHERE refresh_hash = ? AND origin = 'oauth'`)
    .bind(refreshHash)
    .first<GrantRow>();
  if (!row) {
    const reused = await ctx.db
      .prepare(`SELECT ${columns} FROM tokens WHERE prev_refresh_hash = ? AND origin = 'oauth'`)
      .bind(refreshHash)
      .first<GrantRow>();
    if (reused) await revokeFamily(ctx, reused);
    return oauthError(c, 'invalid_grant', 'The refresh token is invalid, expired or already used');
  }
  const now = nowSeconds();
  if (row.client_id !== clientId) return oauthError(c, 'invalid_grant', 'The refresh token was issued to a different client');
  if (row.refresh_expires_at === null || row.refresh_expires_at <= now) {
    await revokeFamily(ctx, row);
    return oauthError(c, 'invalid_grant', 'The refresh token has expired');
  }
  const requested = form.get('scope');
  if (requested) {
    const granted = parseScopes(row.scopes);
    const wanted = parseScopes(requested);
    if (wanted.length === 0 || wanted.some((s) => !granted.includes(s))) return oauthError(c, 'invalid_scope', 'Requested scope exceeds the grant');
  }
  if (!(await usableUser(ctx.db, row.sync_key))) return oauthError(c, 'invalid_grant', 'The account is no longer available');

  const accessToken = generateToken();
  const nextRefresh = generateRefreshToken();
  const rotated = await ctx.db
    .prepare(
      'UPDATE tokens SET token_hash = ?, fingerprint = ?, refresh_hash = ?, prev_refresh_hash = ?, expires_at = ?, refresh_expires_at = ? WHERE token_id = ? AND refresh_hash = ?',
    )
    .bind(
      await sha256Hex(accessToken),
      await tokenFingerprint(accessToken),
      await sha256Hex(nextRefresh),
      refreshHash,
      now + ACCESS_TOKEN_TTL_SECONDS,
      now + REFRESH_TOKEN_TTL_SECONDS,
      row.token_id,
      refreshHash,
    )
    .run();
  if (rotated.meta.changes !== 1) {
    await revokeFamily(ctx, row);
    return oauthError(c, 'invalid_grant', 'The refresh token was used concurrently');
  }
  return tokenResponse(c, accessToken, nextRefresh, row.scopes);
}

export function tokenRoute(ctx: OAuthContext) {
  return async (c: Context): Promise<Response> => {
    await ctx.ready();
    const limited = await limitByIp(ctx, c, 'oauth:token', RATE_LIMITS.oauthToken);
    if (limited !== null) return rateLimited(c, limited);
    const form = await readForm(c);
    if (!form) return oauthError(c, 'invalid_request', 'Body must be application/x-www-form-urlencoded');
    const grant = form.get('grant_type');
    if (grant === 'authorization_code') return authorizationCodeGrant(ctx, c, form);
    if (grant === 'refresh_token') return refreshGrant(ctx, c, form);
    return oauthError(c, 'unsupported_grant_type', 'Supported grants are authorization_code and refresh_token');
  };
}

export function revokeRoute(ctx: OAuthContext) {
  return async (c: Context): Promise<Response> => {
    await ctx.ready();
    const limited = await limitByIp(ctx, c, 'oauth:token', RATE_LIMITS.oauthToken);
    if (limited !== null) return rateLimited(c, limited);
    const form = await readForm(c);
    if (!form) return oauthError(c, 'invalid_request', 'Body must be application/x-www-form-urlencoded');
    const token = form.get('token');
    if (!token) return oauthError(c, 'invalid_request', 'token is required');
    const clientId = form.get('client_id');
    const hash = await sha256Hex(token);
    const row = await ctx.db
      .prepare("SELECT token_id, client_id FROM tokens WHERE origin = 'oauth' AND (token_hash = ? OR refresh_hash = ? OR prev_refresh_hash = ?)")
      .bind(hash, hash, hash)
      .first<{ token_id: string; client_id: string | null }>();
    if (row && (!clientId || clientId === row.client_id)) {
      await ctx.db.prepare('DELETE FROM tokens WHERE token_id = ?').bind(row.token_id).run();
    }
    noStore(c);
    return c.body(null, 200);
  };
}
