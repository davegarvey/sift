import type { Context, MiddlewareHandler } from 'hono';
import { ipv6Groups } from './fetch';
import { diagnostic } from './origin-governor';

export type ProxyRoute = 'feed' | 'article' | 'image';
type LimitBucket = 'fetch' | 'image';

export interface ProxyLimit {
  limit: number;
  windowSeconds: number;
}

export const PROXY_LIMITS: Record<LimitBucket, ProxyLimit> = {
  fetch: { limit: 2000, windowSeconds: 60 },
  image: { limit: 600, windowSeconds: 60 },
};

export const LOCAL_LIMIT_MAX_KEYS = 10_000;
const DIAGNOSTIC_INTERVAL_MS = 10_000;
const UNKNOWN_CLIENT = 'unknown';

export interface ProxyGuardOptions {
  fetchLimiter?: RateLimit;
  imageLimiter?: RateLimit;
  clientIp?: (c: Context) => string | undefined;
  limits?: Partial<Record<LimitBucket, ProxyLimit>>;
}

interface Window {
  windowStart: number;
  count: number;
}

type LimitVerdict =
  | { ok: true }
  | { ok: false; retryAfter: number; limiter: 'binding' | 'local' };

const localWindows: Record<LimitBucket, Map<string, Window>> = {
  fetch: new Map(),
  image: new Map(),
};
const diagnosticState = new Map<string, { at: number; suppressed: number }>();

function parseIpv4(value: string): number[] | null {
  const parts = value.split('.');
  if (parts.length !== 4) return null;
  const octets: number[] = [];
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return null;
    const octet = Number(part);
    if (octet > 255) return null;
    octets.push(octet);
  }
  return octets;
}

export function normaliseClientIp(raw: string | undefined): string {
  if (!raw) return UNKNOWN_CLIENT;
  let ip = raw.trim().replace(/^\[|\]$/g, '').split('%')[0].toLowerCase();
  const mapped = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/.exec(ip);
  if (mapped) ip = mapped[1];
  const v4 = parseIpv4(ip);
  if (v4) return v4.join('.');
  const groups = ipv6Groups(ip);
  if (!groups) return UNKNOWN_CLIENT;
  if (groups.slice(0, 5).every((n) => n === 0) && groups[5] === 0xffff) {
    return [groups[6] >> 8, groups[6] & 0xff, groups[7] >> 8, groups[7] & 0xff].join('.');
  }
  return `v6:${groups.slice(0, 4).map((n) => n.toString(16)).join(':')}`;
}

export function parseTrustedProxyHops(value: string | undefined): number {
  if (!value || !/^\d+$/.test(value.trim())) return 0;
  const hops = Number(value.trim());
  return Number.isSafeInteger(hops) ? hops : 0;
}

export function trustedProxyClientIp(
  socketAddress: (c: Context) => string | undefined,
  hops: number,
): (c: Context) => string | undefined {
  return (c) => {
    if (hops > 0) {
      const entries = (c.req.header('X-Forwarded-For') ?? '')
        .split(',')
        .map((entry) => entry.trim())
        .filter(Boolean);
      const entry = entries[entries.length - hops];
      if (entry !== undefined && normaliseClientIp(entry) !== UNKNOWN_CLIENT) return entry;
    }
    return socketAddress(c);
  };
}

function checkLocalLimit(bucket: LimitBucket, key: string, nowMs: number, config: ProxyLimit): LimitVerdict {
  const { limit, windowSeconds } = config;
  const windows = localWindows[bucket];
  const windowMs = windowSeconds * 1000;
  const windowStart = Math.floor(nowMs / windowMs) * windowMs;
  const current = windows.get(key);
  if (!current || current.windowStart !== windowStart) {
    if (!current && windows.size >= LOCAL_LIMIT_MAX_KEYS) {
      for (const [candidate, entry] of windows) {
        if (entry.windowStart < windowStart) windows.delete(candidate);
      }
      while (windows.size >= LOCAL_LIMIT_MAX_KEYS) {
        const oldest = windows.keys().next().value;
        if (oldest === undefined) break;
        windows.delete(oldest);
      }
    }
    windows.set(key, { windowStart, count: 1 });
    return { ok: true };
  }
  if (current.count >= limit) {
    return {
      ok: false,
      retryAfter: Math.max(1, Math.ceil((windowStart + windowMs - nowMs) / 1000)),
      limiter: 'local',
    };
  }
  current.count += 1;
  return { ok: true };
}

async function checkLimit(bucket: LimitBucket, key: string, options: ProxyGuardOptions): Promise<LimitVerdict> {
  const config = options.limits?.[bucket] ?? PROXY_LIMITS[bucket];
  const binding = bucket === 'image' ? options.imageLimiter : options.fetchLimiter;
  if (binding) {
    try {
      const outcome = await binding.limit({ key });
      if (outcome.success) return { ok: true };
      return { ok: false, retryAfter: config.windowSeconds, limiter: 'binding' };
    } catch {
    }
  }
  return checkLocalLimit(bucket, key, Date.now(), config);
}

function recordRejection(route: ProxyRoute, fields: Record<string, string | number>): void {
  const now = Date.now();
  const id = `${route}:${fields.reason}`;
  const state = diagnosticState.get(id);
  if (state && now - state.at < DIAGNOSTIC_INTERVAL_MS) {
    state.suppressed += 1;
    return;
  }
  diagnosticState.set(id, { at: now, suppressed: 0 });
  diagnostic('client_rejected', { route, ...fields, suppressed: state?.suppressed ?? 0 });
}

function rejection(status: number, message: string, source: string, retryAfter?: number): Response {
  const headers = new Headers({
    'Cache-Control': 'no-store',
    'Content-Type': 'text/plain; charset=utf-8',
    'X-Sift-Request-Source': source,
  });
  if (retryAfter !== undefined) headers.set('Retry-After', String(retryAfter));
  return new Response(message, { status, headers });
}

export function proxyGuard(route: ProxyRoute, options: ProxyGuardOptions = {}): MiddlewareHandler {
  const bucket: LimitBucket = route === 'image' ? 'image' : 'fetch';
  return async (c, next) => {
    const site = c.req.header('Sec-Fetch-Site')?.trim().toLowerCase();
    if (site !== undefined && site !== 'same-origin' && site !== 'none') {
      recordRejection(route, {
        status: 403,
        reason: 'cross_site',
        site: site === 'cross-site' || site === 'same-site' ? site : 'other',
        source: 'same-site-check',
      });
      return rejection(403, 'Cross-site requests are not allowed', 'same-site-check');
    }

    const verdict = await checkLimit(bucket, normaliseClientIp(options.clientIp?.(c)), options);
    if (!verdict.ok) {
      recordRejection(route, {
        status: 429,
        reason: 'rate_limited',
        limiter: verdict.limiter,
        retryAfterMs: verdict.retryAfter * 1000,
        source: 'client-limit',
      });
      return rejection(429, 'Too many requests', 'client-limit', verdict.retryAfter);
    }

    await next();
  };
}

export function clearProxyLimitsForTests(): void {
  localWindows.fetch.clear();
  localWindows.image.clear();
  diagnosticState.clear();
}
