import type { Context } from 'hono';
import { publicOrigin } from '../origin';
import { checkRateLimit } from '../../sync/ratelimit';
import { clientIp, type Scope } from '../../sync/auth';

export interface OAuthContext {
  db: D1Database;
  publicUrl?: string;
  ready(): Promise<void>;
}

export const CONNECTION_TTL_SECONDS = 10 * 60;
export const REQUEST_TTL_SECONDS = 10 * 60;
export const CODE_TTL_SECONDS = 60;
export const ACCESS_TOKEN_TTL_SECONDS = 60 * 60;
export const REFRESH_TOKEN_TTL_SECONDS = 365 * 24 * 60 * 60;
export const METADATA_CACHE_SECONDS = 24 * 60 * 60;
export const ALL_SCOPES: Scope[] = ['read', 'write'];

const CONNECTION_ID_RE = /^[A-Za-z0-9_-]{32}$/;

export function nowSeconds(): number {
  return Math.floor(Date.now() / 1000);
}

export function base64url(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function randomId(byteLength: number): string {
  const bytes = new Uint8Array(byteLength);
  crypto.getRandomValues(bytes);
  return base64url(bytes);
}

export function generateConnectionId(): string {
  return randomId(24);
}

export function isConnectionId(s: string | null | undefined): s is string {
  return typeof s === 'string' && CONNECTION_ID_RE.test(s);
}

export function generateRefreshToken(): string {
  return `r${randomId(32)}`;
}

export function isRefreshTokenFormat(s: string): boolean {
  return /^r[A-Za-z0-9_-]{43}$/.test(s);
}

export function origin(c: Context, publicUrl?: string): string {
  return publicOrigin(c.req.url, publicUrl);
}

export function noStore(c: Context): void {
  c.header('Cache-Control', 'no-store');
  c.header('Pragma', 'no-cache');
}

export function oauthError(c: Context, error: string, description: string, status: 400 | 401 | 403 | 404 | 409 | 410 | 429 = 400): Response {
  noStore(c);
  return c.json({ error, error_description: description }, status);
}

export function rateLimited(c: Context, retryAfter: number): Response {
  noStore(c);
  c.header('Retry-After', String(retryAfter));
  return c.json({ error: 'rate_limited', error_description: 'Too many requests' }, 429);
}

export async function limitByIp(
  ctx: OAuthContext,
  c: Context,
  name: string,
  limits: { windowSeconds: number; limit: number },
): Promise<number | null> {
  const ip = clientIp(c);
  const rl = await checkRateLimit(ctx.db, `${name}:${ip}`, limits.windowSeconds, limits.limit);
  return rl.ok ? null : rl.retryAfter;
}

export function parseRequestedScopes(raw: string | null | undefined): Scope[] | null {
  const parts = (raw ?? '').split(/\s+/).filter(Boolean);
  if (parts.length === 0) return [...ALL_SCOPES];
  const scopes: Scope[] = [];
  for (const part of parts) {
    if (part !== 'read' && part !== 'write') return null;
    if (!scopes.includes(part)) scopes.push(part);
  }
  return ALL_SCOPES.filter((s) => scopes.includes(s));
}

const LOOPBACK_HOSTS = new Set(['127.0.0.1', '[::1]', 'localhost']);

export function isLoopbackHost(hostname: string): boolean {
  return LOOPBACK_HOSTS.has(hostname);
}

export function parseRedirectUri(raw: string): URL | null {
  if (typeof raw !== 'string' || raw.length > 2048) return null;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (url.hash || url.username || url.password) return null;
  if (url.protocol === 'https:') return url;
  if (url.protocol === 'http:') return isLoopbackHost(url.hostname) ? url : null;
  return isPrivateUseScheme(url.protocol) ? url : null;
}

const FORBIDDEN_SCHEMES = new Set(['http:', 'https:', 'javascript:', 'data:', 'file:', 'blob:', 'about:', 'vbscript:', 'ws:', 'wss:']);

export function isPrivateUseScheme(protocol: string): boolean {
  return !FORBIDDEN_SCHEMES.has(protocol);
}

export function redirectDisplayHost(redirectUri: string): string {
  try {
    const url = new URL(redirectUri);
    return isPrivateUseScheme(url.protocol) ? `${url.protocol}//` : url.host;
  } catch {
    return '';
  }
}

export function redirectUriMatches(requested: string, registered: readonly string[]): boolean {
  if (registered.includes(requested)) return true;
  const want = parseRedirectUri(requested);
  if (!want || want.protocol !== 'http:' || !isLoopbackHost(want.hostname)) return false;
  return registered.some((entry) => {
    const have = parseRedirectUri(entry);
    return (
      have !== null &&
      have.protocol === 'http:' &&
      have.hostname === want.hostname &&
      have.pathname === want.pathname &&
      have.search === want.search
    );
  });
}

export function resourceConnectionId(resource: string, base: string): { valid: boolean; connectionId: string | null } {
  if (resource === `${base}/mcp`) return { valid: true, connectionId: null };
  const prefix = `${base}/mcp/c/`;
  if (resource.startsWith(prefix)) {
    const id = resource.slice(prefix.length);
    if (isConnectionId(id)) return { valid: true, connectionId: id };
  }
  return { valid: false, connectionId: null };
}

export function redirectWith(redirectUri: string, params: Record<string, string | undefined>): string {
  const url = new URL(redirectUri);
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined) url.searchParams.set(key, value);
  }
  return url.toString();
}

export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch] as string);
}

export function errorPage(c: Context, message: string, status: 400 | 429 = 400): Response {
  noStore(c);
  c.header('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'none'");
  return c.html(
    `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Sift</title>` +
      `<style>body{font:16px/1.5 system-ui,sans-serif;max-width:32rem;margin:4rem auto;padding:0 1rem;color:#4c4f69}h1{font-size:1.25rem}@media(prefers-color-scheme:dark){body{background:#1e1e2e;color:#cdd6f4}}</style>` +
      `</head><body><h1>Sift cannot continue</h1><p>${escapeHtml(message)}</p></body></html>`,
    status,
  );
}

export function hostOf(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    return new URL(url).host;
  } catch {
    return null;
  }
}

export async function usableUser(db: D1Database, syncKey: string): Promise<boolean> {
  const user = await db
    .prepare('SELECT rotated_at FROM users WHERE sync_key = ?')
    .bind(syncKey)
    .first<{ rotated_at: number | null }>();
  return !!user && user.rotated_at === null;
}
