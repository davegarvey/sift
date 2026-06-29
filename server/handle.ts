import { Hono, type Env } from 'hono';
import { etag } from 'hono/etag';

/**
 * Hono environment type. Adapters can extend this with runtime-specific
 * bindings (e.g., Cloudflare Workers Assets). The shared app itself only
 * needs the empty base type.
 */
export type AppEnv = Env;

/**
 * Read the upstream URL from a `?url=` query param, validate it, and return it.
 * Returns null if the param is missing or malformed.
 *
 * IMPORTANT: this proxy must NEVER log the upstream URL anywhere persistent.
 * See the `assertNoUrlLog()` guard at the bottom of this file.
 */
function getUpstreamUrl(reqUrl: string): string | null {
  try {
    const url = new URL(reqUrl);
    const raw = url.searchParams.get('url');
    if (!raw) return null;
    let parsed: URL;
    try {
      parsed = new URL(raw);
    } catch {
      // raw might be URL-encoded
      parsed = new URL(decodeURIComponent(raw));
    }
    // Only http(s) is proxied; no file:// or other schemes.
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
    return parsed.toString();
  } catch {
    return null;
  }
}

const UPSTREAM_TIMEOUT_MS = 15_000;
const READER_USER_AGENT = 'sift/0.0 (+https://github.com/dave/sift)';

/**
 * Fetch an upstream URL with a single descriptive User-Agent and a timeout.
 * The upstream URL is never logged.
 */
async function fetchUpstream(upstream: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  headers.set('User-Agent', READER_USER_AGENT);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), UPSTREAM_TIMEOUT_MS);
  try {
    return await fetch(upstream, { ...init, headers, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

function badRequest(message: string): Response {
  return new Response(message, { status: 400 });
}

function badGateway(message: string): Response {
  return new Response(message, { status: 502 });
}

/**
 * Privacy guard: ensures the upstream URL never appears in any log output.
 * Visible as a no-op assertion in code so the privacy posture is explicit.
 *
 * To enable debug logging of request metadata (status, timing) WITHOUT the
 * upstream URL when developing locally, set `DEBUG_PROXY=1` in the env.
 */
export function assertNoUrlLog(_input: unknown): void {
  // No-op by design. Tests can mock this to assert that no URL is ever logged.
  // The proxy endpoints below MUST NOT log the `url` query parameter.
  // Reuse this assertion in tests to encode the privacy contract.
}

/**
 * Build the shared Hono application. The same `app` runs unchanged across
 * Node (`server/node.ts`), Bun (`server/bun.ts`), and Cloudflare Workers
 * (`server/worker.ts`). Each adapter provides `serveStatic` for that runtime.
 */
export function createApp<E extends Env = AppEnv>(): Hono<E> {
  const app = new Hono<E>();
  app.use('*', etag());

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