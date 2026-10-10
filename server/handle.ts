import { Hono, type Env, type MiddlewareHandler } from 'hono';
import {
  getUpstreamUrl,
  fetchUpstreamWithPolicy,
  fetchFeedCached,
  cancelResponse,
  badRequest,
  badGateway,
} from './fetch';
import { assertNoUrlLog } from './log';
import { ARTICLE_MAX_BYTES, FEED_MAX_BYTES, IMAGE_MAX_BYTES, capBody, declaredLengthExceeds } from './body-cap';
import { proxyGuard, type ProxyGuardOptions } from './proxy-guard';
import { createSyncRoutes } from './sync/routes';
import { createMcpRoutes } from './agent/mcp';

export type AppEnv = Env;

const PROXY_CSP = "default-src 'none'; sandbox";
const IMAGE_CSP = 'sandbox';

function isolateProxyResponse(csp: string): MiddlewareHandler {
  return async (c, next) => {
    await next();
    c.res.headers.set('Content-Security-Policy', csp);
    c.res.headers.set('X-Content-Type-Options', 'nosniff');
  };
}

function proxyError(response: Response): Response {
  const headers = new Headers({ 'Cache-Control': 'no-store', 'Content-Type': 'text/plain; charset=utf-8' });
  for (const name of ['Retry-After', 'X-Sift-Retry-After', 'X-Sift-Request-Source', 'X-Sift-Cache']) {
    const value = response.headers.get(name);
    if (value) headers.set(name, value);
  }
  return new Response(response.body, { status: response.status, headers });
}

export interface CreateAppOptions {
  proxy?: ProxyGuardOptions;
  db?: D1Database;
  pollDb?: D1Database;
  publicUrl?: string;
  scheduledHandler?: (event: { scheduledTime: Date; waitUntil?: (p: Promise<unknown>) => void }) => Promise<void>;
}

export function createApp<E extends Env = AppEnv>(options: CreateAppOptions = {}): Hono<E> {
  const { db, pollDb, publicUrl, scheduledHandler, proxy } = options;
  const app = new Hono<E>();

  app.use('/feed', isolateProxyResponse(PROXY_CSP));
  app.use('/article', isolateProxyResponse(PROXY_CSP));
  app.use('/img', isolateProxyResponse(IMAGE_CSP));
  app.use('/feed', proxyGuard('feed', proxy));
  app.use('/article', proxyGuard('article', proxy));
  app.use('/img', proxyGuard('image', proxy));

  /**
   * GET /feed?url=<encoded>
   * Stateless proxy: fetches an upstream RSS/Atom/RDF feed and pipes the body
   * back to the browser. Forwards conditional headers (If-None-Match /
   * If-Modified-Since) and passes through 304 responses. Never logs the URL.
   */
  app.get('/feed', async (c) => {
    const upstream = await getUpstreamUrl(c.req.url);
    if (!upstream) return badRequest('Missing or invalid `url` query parameter');
    assertNoUrlLog(upstream);

    const inm = c.req.header('If-None-Match');
    const ims = c.req.header('If-Modified-Since');

    let feedResult: Awaited<ReturnType<typeof fetchFeedCached>>;
    try {
      feedResult = await fetchFeedCached(upstream, {
        etag: inm ?? undefined,
        lastModified: ims ?? undefined,
      }, db);
    } catch {
      return badGateway('Failed to fetch upstream feed');
    }

    const upstreamRes = feedResult.response;

    if (upstreamRes.status !== 304 && declaredLengthExceeds(upstreamRes.headers, FEED_MAX_BYTES)) {
      void cancelResponse(upstreamRes);
      return badGateway('Upstream response is too large');
    }

    // Pass through 304 with no body.
    const retryAfter = upstreamRes.headers.get('X-Sift-Retry-After');

    if (upstreamRes.status === 304) {
      const headers = new Headers({
        ETag: upstreamRes.headers.get('ETag') ?? '',
        'Last-Modified': upstreamRes.headers.get('Last-Modified') ?? '',
        Age: upstreamRes.headers.get('Age') ?? '0',
        'X-Sift-Cache': upstreamRes.headers.get('X-Sift-Cache') ?? feedResult.state,
        'X-Sift-Request-Source': upstreamRes.headers.get('X-Sift-Request-Source') ?? 'feed-cache',
      });
      if (retryAfter) headers.set('X-Sift-Retry-After', retryAfter);
      return new Response(null, { status: 304, headers });
    }

    // For non-2xx (other than 304), return the upstream status to the client.
    if (upstreamRes.status < 200 || upstreamRes.status >= 300) {
      return proxyError(new Response(capBody(upstreamRes.body, FEED_MAX_BYTES), {
        status: upstreamRes.status,
        headers: upstreamRes.headers,
      }));
    }

    const headers = new Headers();
    headers.set('Content-Type', 'application/xml; charset=utf-8');
    headers.set('Cache-Control', 'no-cache, no-store');
    headers.set('Age', upstreamRes.headers.get('Age') ?? '0');
    headers.set('X-Sift-Cache', upstreamRes.headers.get('X-Sift-Cache') ?? feedResult.state);
    headers.set('X-Sift-Request-Source', upstreamRes.headers.get('X-Sift-Request-Source') ?? 'upstream');
    const etagHeader = upstreamRes.headers.get('ETag');
    if (etagHeader) headers.set('ETag', etagHeader);
    const lastModified = upstreamRes.headers.get('Last-Modified');
    if (lastModified) headers.set('Last-Modified', lastModified);
    if (retryAfter) headers.set('X-Sift-Retry-After', retryAfter);
    return new Response(capBody(upstreamRes.body, FEED_MAX_BYTES), { status: 200, headers });
  });

  /**
   * GET /article?url=<encoded>
   * Stateless proxy: fetches an upstream article HTML and pipes it back. The
   * browser runs Readability on the result. Never logs the URL.
   */
  app.get('/article', async (c) => {
    const upstream = await getUpstreamUrl(c.req.url);
    if (!upstream) return badRequest('Missing or invalid `url` query parameter');
    assertNoUrlLog(upstream);

    let upstreamRes: Response;
    try {
      upstreamRes = await fetchUpstreamWithPolicy(upstream, {}, { db, route: 'article' });
    } catch {
      const response = badGateway('Failed to fetch upstream article');
      response.headers.set('Cache-Control', 'no-store');
      response.headers.set('X-Sift-Request-Source', 'local-gate');
      return response;
    }

    if (declaredLengthExceeds(upstreamRes.headers, ARTICLE_MAX_BYTES)) {
      void cancelResponse(upstreamRes);
      return badGateway('Upstream response is too large');
    }

    if (upstreamRes.status < 200 || upstreamRes.status >= 300) {
      return proxyError(new Response(capBody(upstreamRes.body, ARTICLE_MAX_BYTES), {
        status: upstreamRes.status,
        headers: upstreamRes.headers,
      }));
    }

    const headers = new Headers();
    headers.set('Content-Type', 'text/html; charset=utf-8');
    headers.set('Cache-Control', 'no-cache, no-store');
    headers.set('X-Sift-Request-Source', upstreamRes.headers.get('X-Sift-Request-Source') ?? 'upstream');
    const etagHeader = upstreamRes.headers.get('ETag');
    if (etagHeader) headers.set('ETag', etagHeader);
    const lastModified = upstreamRes.headers.get('Last-Modified');
    if (lastModified) headers.set('Last-Modified', lastModified);
    return new Response(capBody(upstreamRes.body, ARTICLE_MAX_BYTES), { status: upstreamRes.status, headers });
  });

  /**
   * GET /img?url=<encoded>
   * Stateless single-shot image proxy: fetches an upstream image and pipes it
   * back with its original Content-Type. Non-image responses are refused. Used
   * by the browser to inline images as data: URIs in extracted article HTML.
   * Never logs the URL.
   */
  app.get('/img', async (c) => {
    const upstream = await getUpstreamUrl(c.req.url);
    if (!upstream) return badRequest('Missing or invalid `url` query parameter');
    assertNoUrlLog(upstream);

    let upstreamRes: Response;
    try {
      upstreamRes = await fetchUpstreamWithPolicy(upstream, {}, { db, route: 'image' });
    } catch {
      const response = badGateway('Failed to fetch upstream image');
      response.headers.set('Cache-Control', 'no-store');
      response.headers.set('X-Sift-Request-Source', 'local-gate');
      return response;
    }

    if (declaredLengthExceeds(upstreamRes.headers, IMAGE_MAX_BYTES)) {
      void cancelResponse(upstreamRes);
      return badGateway('Upstream response is too large');
    }

    if (upstreamRes.status < 200 || upstreamRes.status >= 300) {
      return proxyError(new Response(capBody(upstreamRes.body, IMAGE_MAX_BYTES), {
        status: upstreamRes.status,
        headers: upstreamRes.headers,
      }));
    }

    const contentType = upstreamRes.headers.get('Content-Type')?.trim();
    if (!contentType || !/^image\//i.test(contentType)) {
      void cancelResponse(upstreamRes);
      return badGateway('Upstream response is not an image');
    }

    const headers = new Headers();
    headers.set('Content-Type', contentType);
    headers.set('Cache-Control', 'public, max-age=2592000, immutable');
    headers.set('X-Sift-Request-Source', upstreamRes.headers.get('X-Sift-Request-Source') ?? 'upstream');
    return new Response(capBody(upstreamRes.body, IMAGE_MAX_BYTES), { status: upstreamRes.status, headers });
  });

  // Sync routes — only registered when a D1 binding is provided.
  if (db) {
    app.route('/', createMcpRoutes({ db, pollDb, publicUrl }));
    const syncApp = createSyncRoutes(db, { pollDb });
    app.route('/', syncApp);
    if (scheduledHandler) {
      // Mount scheduled handler as a module-level export so worker.ts can hook it.
      (app as unknown as { __scheduledHandler?: typeof scheduledHandler }).__scheduledHandler = scheduledHandler; // why: stashing handler on Hono app; not in public types
    }
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
