/**
 * Feed fetching. The browser talks to our own `/feed?url=` proxy to defeat
 * CORS, then we parse the returned XML body in the browser.
 */

export interface ConditionalHeaders {
  etag?: string | null;
  lastModified?: string | null;
}

export type FeedFetchResult =
  | { kind: 'not-modified' }
  | { kind: 'modified'; body: string; etag?: string | null; lastModified?: string | null }
  | { kind: 'error'; status: number; message: string };

export async function fetchFeed(
  url: string,
  conditional: ConditionalHeaders = {},
): Promise<FeedFetchResult> {
  const proxyUrl = `/feed?url=${encodeURIComponent(url)}`;
  const headers = new Headers();
  if (conditional.etag) headers.set('If-None-Match', conditional.etag);
  if (conditional.lastModified) headers.set('If-Modified-Since', conditional.lastModified);

  let res: Response;
  try {
    res = await fetch(proxyUrl, { headers });
  } catch (err) {
    return { kind: 'error', status: 0, message: (err as Error).message };
  }

  if (res.status === 304) {
    return { kind: 'not-modified' };
  }
  if (res.status < 200 || res.status >= 300) {
    return { kind: 'error', status: res.status, message: `HTTP ${res.status}` };
  }

  const body = await res.text();
  return {
    kind: 'modified',
    body,
    etag: res.headers.get('ETag'),
    lastModified: res.headers.get('Last-Modified'),
  };
}

/**
 * Fetch an arbitrary HTML page via the `/article?url=` proxy. Used by
 * discovery to look for `<link rel="alternate">` feed links.
 */
export async function fetchArticleHtml(url: string): Promise<string | null> {
  const proxyUrl = `/article?url=${encodeURIComponent(url)}`;
  try {
    const res = await fetch(proxyUrl);
    if (!res.ok) return null;
    return await res.text();
  } catch {
    return null;
  }
}

/**
 * Fetch an upstream image via the `/img?url=` proxy and return it as a
 * `data:` URI suitable for inlining in article HTML.
 */
export async function fetchImageAsDataUri(url: string): Promise<string | null> {
  const proxyUrl = `/img?url=${encodeURIComponent(url)}`;
  try {
    const res = await fetch(proxyUrl);
    if (!res.ok) return null;
    const blob = await res.blob();
    const buf = await blob.arrayBuffer();
    const bytes = new Uint8Array(buf);
    let bin = '';
    const chunk = 0x8000;
    for (let i = 0; i < bytes.length; i += chunk) {
      bin += String.fromCharCode(...bytes.subarray(i, i + chunk));
    }
    const base64 = btoa(bin);
    const type = blob.type || 'image/png';
    return `data:${type};base64,${base64}`;
  } catch {
    return null;
  }
}