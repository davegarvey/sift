import { Hono, type Env } from 'hono';
import { etag } from 'hono/etag';
import {
  getUpstreamUrl,
  fetchUpstream,
  badRequest,
  badGateway,
  assertNoUrlLog,
} from './fetch';
import { Relay, sseResponse } from './relay';
import { handleMcpRequest } from './mcp';

export type AppEnv = Env;

export function createApp<E extends Env = AppEnv>(relay?: Relay): Hono<E> {
  if (!relay && typeof process !== 'undefined' && process.env?.MCP_ENABLED === 'true') {
    relay = new Relay();
  }
  const mcpEnabled = relay !== undefined;
  const app = new Hono<E>();
  app.use('/feed', etag());
  app.use('/article', etag());
  app.use('/img', etag());

  /**
   * GET /feed?url=<encoded>
   * Stateless proxy: fetches an upstream RSS/Atom/RDF feed and pipes the body
   * back to the browser. Forwards conditional headers (If-None-Match /
   * If-Modified-Since) and passes through 304 responses. Never logs the URL.
   */
  app.get('/feed', async (c) => {
    const upstream = getUpstreamUrl(c.req.url);
    if (!upstream) return badRequest('Missing or invalid `url` query parameter');
    assertNoUrlLog(upstream);

    const reqHeaders = new Headers();
    const inm = c.req.header('If-None-Match');
    if (inm) reqHeaders.set('If-None-Match', inm);
    const ims = c.req.header('If-Modified-Since');
    if (ims) reqHeaders.set('If-Modified-Since', ims);

    let upstreamRes: Response;
    try {
      upstreamRes = await fetchUpstream(upstream, { headers: reqHeaders });
    } catch {
      return badGateway('Failed to fetch upstream feed');
    }

    // Pass through 304 with no body.
    if (upstreamRes.status === 304) {
      return new Response(null, {
        status: 304,
        headers: {
          ETag: upstreamRes.headers.get('ETag') ?? '',
          'Last-Modified': upstreamRes.headers.get('Last-Modified') ?? '',
        },
      });
    }

    // For non-2xx (other than 304), return the upstream status to the client.
    if (upstreamRes.status < 200 || upstreamRes.status >= 300) {
      return new Response(upstreamRes.body, {
        status: upstreamRes.status,
        headers: upstreamRes.headers,
      });
    }

    const headers = new Headers();
    headers.set('Content-Type', 'application/xml; charset=utf-8');
    const etagHeader = upstreamRes.headers.get('ETag');
    if (etagHeader) headers.set('ETag', etagHeader);
    const lastModified = upstreamRes.headers.get('Last-Modified');
    if (lastModified) headers.set('Last-Modified', lastModified);
    return new Response(upstreamRes.body, { status: 200, headers });
  });

  /**
   * GET /article?url=<encoded>
   * Stateless proxy: fetches an upstream article HTML and pipes it back. The
   * browser runs Readability on the result. Never logs the URL.
   */
  app.get('/article', async (c) => {
    const upstream = getUpstreamUrl(c.req.url);
    if (!upstream) return badRequest('Missing or invalid `url` query parameter');
    assertNoUrlLog(upstream);

    let upstreamRes: Response;
    try {
      upstreamRes = await fetchUpstream(upstream);
    } catch {
      return badGateway('Failed to fetch upstream article');
    }

    const headers = new Headers();
    headers.set('Content-Type', 'text/html; charset=utf-8');
    const etagHeader = upstreamRes.headers.get('ETag');
    if (etagHeader) headers.set('ETag', etagHeader);
    const lastModified = upstreamRes.headers.get('Last-Modified');
    if (lastModified) headers.set('Last-Modified', lastModified);
    return new Response(upstreamRes.body, { status: upstreamRes.status, headers });
  });

  /**
   * GET /img?url=<encoded>
   * Stateless single-shot image proxy: fetches an upstream image and pipes it
   * back with its original Content-Type. Used by the browser to inline images
   * as data: URIs in extracted article HTML. Never logs the URL.
   */
  app.get('/img', async (c) => {
    const upstream = getUpstreamUrl(c.req.url);
    if (!upstream) return badRequest('Missing or invalid `url` query parameter');
    assertNoUrlLog(upstream);

    let upstreamRes: Response;
    try {
      upstreamRes = await fetchUpstream(upstream);
    } catch {
      return badGateway('Failed to fetch upstream image');
    }

    const headers = new Headers();
    const contentType = upstreamRes.headers.get('Content-Type');
    if (contentType) headers.set('Content-Type', contentType);
    headers.set('Cache-Control', 'public, max-age=86400');
    return new Response(upstreamRes.body, { status: upstreamRes.status, headers });
  });

  if (mcpEnabled && relay) {
    app.get('/api/capabilities', (c) => c.json({ mcp: true }));

    app.get('/api/events', () => sseResponse(relay));

    app.post('/api/events', async (c) => {
      const body = await c.req.json<Record<string, unknown>>();
      const kind = body.kind;
      if (kind === 'sync' && Array.isArray(body.feeds)) {
        relay.handleSync(body.feeds as import('../src/db/types').Feed[]);
        return c.body(null, 204);
      }
      if (kind === 'ack' && typeof body.id === 'string') {
        relay.handleAck(body.id);
        return c.body(null, 204);
      }
      return c.text('Invalid request', 400);
    });

    app.all('/mcp', async (c) => {
      const raw = c.req.raw;
      const headers = new Headers(raw.headers);
      if (raw.method === 'POST') {
        // SDK's transport requires Accept header to advertise support for
        // both application/json and text/event-stream. Ensure they're present
        // so clients like OpenCode (which may send */*) are not rejected.
        if (!headers.has('accept') || !headers.get('accept')!.includes('application/json')) {
          const existing = headers.get('accept') || '';
          headers.set('accept', existing
            ? `${existing}, application/json`
            : 'application/json');
        }
        if (!headers.get('accept')!.includes('text/event-stream')) {
          headers.set('accept', `${headers.get('accept')}, text/event-stream`);
        }
      }
      const request = new Request(raw.url, {
        method: raw.method,
        headers,
        body: raw.method === 'GET' ? undefined : await raw.blob(),
      });
      return handleMcpRequest(request, relay);
    });
  }

  // Static serving: served by adapter-supplied middleware below.
  // The adapter calls `app.use('/assets/*', serveStatic(...))` and
  // `app.get('/', serveStatic({ path: './index.html' }))` for its runtime.
  // We expose the app here so adapters can register static routes.
  return app;
}

/**
 * Default app: for environments that don't need static serving (e.g., the
 * Hono app without adapters). Adapters should call `createApp()` directly
 * and chain their own static-serve middleware after the proxy routes.
 */
export const app = createApp();