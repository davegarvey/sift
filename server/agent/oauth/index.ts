import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { ensureSchema } from '../../sync/schema';
import { authorizeRoute } from './authorize';
import { registerRoute } from './clients';
import { createDecisionRoutes } from './decisions';
import { createMetadataRoutes } from './metadata';
import { revokeRoute, tokenRoute } from './token';
import type { OAuthContext } from './util';

export interface OAuthRoutesOptions {
  db: D1Database;
  publicUrl?: string;
}

const crossOrigin = cors({
  origin: '*',
  allowMethods: ['GET', 'POST', 'OPTIONS'],
  allowHeaders: ['Content-Type', 'Authorization', 'MCP-Protocol-Version'],
  maxAge: 86400,
});

export function createOAuthRoutes({ db, publicUrl }: OAuthRoutesOptions): Hono {
  let schemaReady: Promise<void> | null = null;
  const ctx: OAuthContext = {
    db,
    publicUrl,
    ready: () => {
      schemaReady ??= ensureSchema(db);
      return schemaReady;
    },
  };

  const app = new Hono();
  for (const path of [
    '/.well-known/oauth-protected-resource',
    '/.well-known/oauth-protected-resource/*',
    '/.well-known/oauth-authorization-server',
    '/.well-known/oauth-authorization-server/*',
    '/oauth/register',
    '/oauth/token',
    '/oauth/revoke',
    '/oauth/c/:id/register',
    '/oauth/c/:id/token',
    '/oauth/c/:id/revoke',
  ]) {
    app.use(path, crossOrigin);
  }

  app.route('/', createMetadataRoutes(ctx));

  const register = registerRoute(ctx);
  const token = tokenRoute(ctx);
  const revoke = revokeRoute(ctx);
  const authorize = authorizeRoute(ctx);
  app.post('/oauth/register', register);
  app.post('/oauth/c/:id/register', register);
  app.post('/oauth/token', token);
  app.post('/oauth/c/:id/token', token);
  app.post('/oauth/revoke', revoke);
  app.post('/oauth/c/:id/revoke', revoke);
  app.get('/oauth/authorize', authorize);
  app.get('/oauth/c/:id/authorize', authorize);

  app.route('/', createDecisionRoutes(ctx));
  return app;
}
