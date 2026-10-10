import { Hono, type Context } from 'hono';
import { isConnectionId, origin, type OAuthContext } from './util';

function connectionOrNull(c: Context): string | null | false {
  const id = c.req.param('id');
  if (id === undefined) return null;
  return isConnectionId(id) ? id : false;
}

export function createMetadataRoutes(ctx: OAuthContext): Hono {
  const app = new Hono();

  const protectedResource = (c: Context) => {
    const id = connectionOrNull(c);
    if (id === false) return c.json({ error: 'not_found' }, 404);
    const base = origin(c, ctx.publicUrl);
    return c.json({
      resource: id ? `${base}/mcp/c/${id}` : `${base}/mcp`,
      authorization_servers: [id ? `${base}/oauth/c/${id}` : base],
      scopes_supported: ['read', 'write'],
      bearer_methods_supported: ['header'],
      resource_name: 'Sift',
    });
  };

  const authorizationServer = (c: Context) => {
    const id = connectionOrNull(c);
    if (id === false) return c.json({ error: 'not_found' }, 404);
    const base = origin(c, ctx.publicUrl);
    const endpoints = id ? `${base}/oauth/c/${id}` : `${base}/oauth`;
    return c.json({
      issuer: id ? `${base}/oauth/c/${id}` : base,
      authorization_endpoint: `${endpoints}/authorize`,
      token_endpoint: `${endpoints}/token`,
      registration_endpoint: `${endpoints}/register`,
      revocation_endpoint: `${endpoints}/revoke`,
      response_types_supported: ['code'],
      grant_types_supported: ['authorization_code', 'refresh_token'],
      code_challenge_methods_supported: ['S256'],
      token_endpoint_auth_methods_supported: ['none'],
      scopes_supported: ['read', 'write'],
      client_id_metadata_document_supported: true,
    });
  };

  app.get('/.well-known/oauth-protected-resource', protectedResource);
  app.get('/.well-known/oauth-protected-resource/mcp/c/:id', protectedResource);
  app.get('/.well-known/oauth-authorization-server', authorizationServer);
  app.get('/.well-known/oauth-authorization-server/oauth/c/:id', authorizationServer);
  return app;
}
