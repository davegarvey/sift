import type { Context } from 'hono';
import { PAIRING_ALPHABET, PAIRING_CODE_LEN } from '../../sync/auth';
import { RATE_LIMITS } from '../../sync/ratelimit';
import { resolveClient } from './clients';
import {
  REQUEST_TTL_SECONDS,
  errorPage,
  isConnectionId,
  limitByIp,
  nowSeconds,
  origin,
  parseRequestedScopes,
  randomId,
  redirectUriMatches,
  redirectWith,
  resourceConnectionId,
  type OAuthContext,
} from './util';

const CODE_CHALLENGE_RE = /^[A-Za-z0-9_-]{43}$/;

function approvalCode(): string {
  const bytes = new Uint8Array(PAIRING_CODE_LEN);
  crypto.getRandomValues(bytes);
  let s = '';
  for (const b of bytes) s += PAIRING_ALPHABET[b % PAIRING_ALPHABET.length];
  return s;
}

export function authorizeRoute(ctx: OAuthContext) {
  return async (c: Context): Promise<Response> => {
    await ctx.ready();
    const limited = await limitByIp(ctx, c, 'oauth:authorize', RATE_LIMITS.oauthAuthorize);
    if (limited !== null) return errorPage(c, 'Too many authorisation attempts. Try again shortly.', 429);

    const q = (name: string): string | undefined => c.req.query(name);
    const clientId = q('client_id');
    if (!clientId) return errorPage(c, 'The request does not identify a client.');
    const client = await resolveClient(ctx, clientId);
    if (!client) return errorPage(c, 'The client is not registered or its metadata could not be verified.');
    const redirectUri = q('redirect_uri');
    if (!redirectUri || !redirectUriMatches(redirectUri, client.redirectUris)) {
      return errorPage(c, 'The redirect address does not match the client registration.');
    }

    const state = q('state');
    const fail = (error: string, description: string): Response =>
      c.redirect(redirectWith(redirectUri, { error, error_description: description, state }), 302);

    if (q('response_type') !== 'code') return fail('unsupported_response_type', 'response_type must be code');
    if (!state) return fail('invalid_request', 'state is required');
    const challenge = q('code_challenge');
    if (!challenge || !CODE_CHALLENGE_RE.test(challenge)) return fail('invalid_request', 'A valid S256 code_challenge is required');
    if (q('code_challenge_method') !== 'S256') return fail('invalid_request', 'code_challenge_method must be S256');
    const scopes = parseRequestedScopes(q('scope'));
    if (!scopes) return fail('invalid_scope', 'Supported scopes are read and write');

    const base = origin(c, ctx.publicUrl);
    const pathId = c.req.param('id');
    let connectionId = isConnectionId(pathId) ? pathId : null;
    const resource = q('resource');
    if (resource !== undefined) {
      const parsed = resourceConnectionId(resource, base);
      if (!parsed.valid) return fail('invalid_target', 'resource must identify this Sift server');
      if (parsed.connectionId) {
        if (connectionId && connectionId !== parsed.connectionId) return fail('invalid_target', 'resource does not match the connection');
        connectionId = parsed.connectionId;
      }
    }

    const requestId = randomId(32);
    const now = nowSeconds();
    let inserted = false;
    for (let attempt = 0; attempt < 8 && !inserted; attempt++) {
      try {
        await ctx.db
          .prepare(
            'INSERT INTO oauth_requests (request_id, approval_code, client_id, redirect_uri, code_challenge, scopes, state, resource, connection_id, created_at, expires_at) ' +
              'VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
          )
          .bind(requestId, approvalCode(), clientId, redirectUri, challenge, scopes.join(' '), state, resource ?? null, connectionId, now, now + REQUEST_TTL_SECONDS)
          .run();
        inserted = true;
      } catch (err) {
        if (!String(err).includes('UNIQUE')) throw err;
      }
    }
    if (!inserted) return errorPage(c, 'Sift could not start the request. Try again.');

    c.header('Cache-Control', 'no-store');
    return c.redirect(`${base}/connect?request=${requestId}`, 302);
  };
}
