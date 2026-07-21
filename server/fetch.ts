export const UPSTREAM_TIMEOUT_MS = 15_000;
export const READER_USER_AGENT = 'sift/0.0 (+https://github.com/dave/sift)';

export function getUpstreamUrl(reqUrl: string): string | null {
  try {
    const url = new URL(reqUrl);
    const raw = url.searchParams.get('url');
    if (!raw) return null;
    let parsed: URL;
    try {
      parsed = new URL(raw);
    } catch {
      console.warn('getUpstreamUrl: failed to parse URL, trying decoded', raw);
      parsed = new URL(decodeURIComponent(raw));
    }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
    return parsed.toString();
  } catch {
    return null;
  }
}

export async function fetchUpstream(upstream: string, init: RequestInit = {}): Promise<Response> {
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

export function badRequest(message: string): Response {
  return new Response(message, { status: 400 });
}

export function badGateway(message: string): Response {
  return new Response(message, { status: 502 });
}

export { assertNoUrlLog } from './log';
