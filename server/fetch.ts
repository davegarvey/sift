export const UPSTREAM_TIMEOUT_MS = 15_000;
export const READER_USER_AGENT = 'sift/0.0 (+https://github.com/dave/sift)';
export const FEED_CACHE_TTL_MS = 15 * 60_000;
export const FEED_CACHE_MAX_ENTRIES = 256;
export const FEED_CACHE_MAX_BODY_BYTES = 2 * 1024 * 1024;
export const FEED_RETRY_FALLBACK_MS = 30 * 60_000;
export const FEED_RETRY_MAX_MS = 24 * 60 * 60_000;

const DENY_HOST_SUFFIXES = ['.localhost', '.localdomain', '.local', '.internal'];
const DOH_URL = 'https://cloudflare-dns.com/dns-query';
const DOH_TIMEOUT_MS = 5_000;
const TARGET_CACHE_TTL_MS = 5 * 60_000;

const targetCache = new Map<string, { decision: boolean; at: number }>();

interface CachedFeed {
  body: Uint8Array;
  etag: string | null;
  lastModified: string | null;
  fetchedAt: number;
}

interface FeedRepresentationStore {
  get(upstream: string): Promise<CachedFeed | undefined>;
  put(upstream: string, entry: CachedFeed): Promise<void>;
}

interface CacheApiLike {
  match(request: Request): Promise<Response | undefined>;
  put(request: Request, response: Response): Promise<void>;
}

interface CacheStorageLike {
  default?: CacheApiLike;
}

interface FeedConditionalHeaders {
  etag?: string;
  lastModified?: string;
}

interface FeedCacheResult {
  response: Response;
  state: 'hit' | 'miss' | 'revalidated' | 'cooldown' | 'bypass';
  ageSeconds?: number;
}

type RevalidationResult =
  | { kind: 'cached'; entry: CachedFeed; state: 'miss' | 'revalidated' }
  | { kind: 'response'; response: Response; state: 'bypass' };

const WORKER_FETCHED_AT_HEADER = 'X-Sift-Cache-Fetched-At';
const feedCache = new Map<string, CachedFeed>();
const feedRevalidations = new Map<string, Promise<RevalidationResult>>();
const feedRetries = new Map<string, number>();

function isDeniedHostname(hostname: string): boolean {
  const h = hostname.replace(/\.$/, '');
  if (h === 'localhost') return true;
  for (const suffix of DENY_HOST_SUFFIXES) {
    if (h.endsWith(suffix)) return true;
  }
  return false;
}

function parseIpv4(s: string): number | null {
  const parts = s.split('.');
  if (parts.length !== 4) return null;
  let v = 0;
  for (const p of parts) {
    if (!/^\d{1,3}$/.test(p)) return null;
    const n = Number(p);
    if (n > 255) return null;
    v = (v << 8) | n;
  }
  return v >>> 0;
}

function isDeniedIpv4(v: number): boolean {
  if (v <= 0x00ffffff) return true; // 0.0.0.0/8
  if (v >= 0x0a000000 && v <= 0x0affffff) return true; // 10.0.0.0/8
  if (v >= 0x64400000 && v <= 0x647fffff) return true; // 100.64.0.0/10 (CGNAT)
  if (v >= 0x7f000000 && v <= 0x7fffffff) return true; // 127.0.0.0/8 (loopback)
  if (v >= 0xa9fe0000 && v <= 0xa9feffff) return true; // 169.254.0.0/16 (link-local + metadata)
  if (v >= 0xac100000 && v <= 0xac1fffff) return true; // 172.16.0.0/12
  if (v >= 0xc0000200 && v <= 0xc00002ff) return true; // 192.0.2.0/24 (TEST-NET)
  if (v >= 0xc0a80000 && v <= 0xc0a8ffff) return true; // 192.168.0.0/16
  if (v >= 0xc6120000 && v <= 0xc613ffff) return true; // 198.18.0.0/15 (benchmark)
  if (v >= 0xc6336400 && v <= 0xc63364ff) return true; // 198.51.100.0/24 (TEST-NET-2)
  if (v >= 0xcb007100 && v <= 0xcb0071ff) return true; // 203.0.113.0/24 (TEST-NET-3)
  if (v >= 0xe0000000) return true; // 224.0.0.0/4 multicast + 240.0.0.0/4 reserved
  return false;
}

function ipv6Groups(s: string): number[] | null {
  let t = s.toLowerCase().replace(/^\[|\]$/g, '').split('%')[0];
  if (t.includes('.')) return null;
  const z = t.indexOf('::');
  if (z !== -1) {
    const left = t.slice(0, z) ? t.slice(0, z).split(':') : [];
    const right = t.slice(z + 2) ? t.slice(z + 2).split(':') : [];
    if (left.length + right.length > 7) return null;
    t = [...left, ...Array(8 - left.length - right.length).fill('0'), ...right].join(':');
  }
  const parts = t.split(':');
  if (parts.length !== 8) return null;
  const nums: number[] = [];
  for (const p of parts) {
    if (!/^[0-9a-f]{1,4}$/.test(p)) return null;
    nums.push(parseInt(p, 16));
  }
  return nums;
}

function isDeniedIpv6(s: string): boolean {
  const g = ipv6Groups(s);
  if (!g) return false;
  // :: (unspecified) and ::1 (loopback)
  if (g.every((n) => n === 0)) return true;
  if (g.slice(0, 7).every((n) => n === 0) && g[7] === 1) return true;
  // fc00::/7 unique-local, fe80::/10 link-local, ff00::/8 multicast
  if ((g[0] & 0xfe00) === 0xfc00) return true;
  if ((g[0] & 0xffc0) === 0xfe80) return true;
  if ((g[0] & 0xff00) === 0xff00) return true;
  // ::ffff:<ipv4> — check the embedded IPv4 (g[5] holds the ffff marker,
  // the 32-bit IPv4 sits in g[6..7]).
  if (g.slice(0, 5).every((n) => n === 0) && g[5] === 0xffff) {
    const v4 = ((g[6] << 16) | g[7]) >>> 0;
    return isDeniedIpv4(v4);
  }
  return false;
}

async function resolveHost(hostname: string): Promise<string[] | null> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), DOH_TIMEOUT_MS);
    try {
      const [a, aaaa] = await Promise.all([
        fetch(`${DOH_URL}?name=${encodeURIComponent(hostname)}&type=A`, {
          headers: { accept: 'application/dns-json' },
          signal: controller.signal,
        }),
        fetch(`${DOH_URL}?name=${encodeURIComponent(hostname)}&type=AAAA`, {
          headers: { accept: 'application/dns-json' },
          signal: controller.signal,
        }),
      ]);
      const results: string[] = [];
      for (const res of [a, aaaa]) {
        if (!res.ok) return null;
        const data = (await res.json()) as { Answer?: { type?: number; data?: string }[] };
        for (const ans of data.Answer ?? []) {
          // Only terminal A (1) and AAAA (28) records are IPs. CNAME (5)
          // and other record types carry hostnames, not addresses, and must
          // not be fed into the deny-range check.
          if (ans.type !== 1 && ans.type !== 28) continue;
          if (typeof ans.data === 'string') results.push(ans.data);
        }
      }
      return results;
    } finally {
      clearTimeout(timer);
    }
  } catch {
    return null;
  }
}

async function isDeniedTarget(hostname: string): Promise<boolean> {
  if (isDeniedHostname(hostname)) return true;
  if (hostname.includes(':')) {
    return isDeniedIpv6(hostname);
  }
  const v4 = parseIpv4(hostname);
  if (v4 !== null) {
    return isDeniedIpv4(v4);
  }
  const cached = targetCache.get(hostname);
  if (cached && Date.now() - cached.at < TARGET_CACHE_TTL_MS) {
    return cached.decision;
  }
  const ips = await resolveHost(hostname);
  // Fail closed: an unresolvable DoH result refuses the target.
  let decision = true;
  if (ips !== null) {
    decision = false;
    for (const ip of ips) {
      if (ip.includes(':') ? isDeniedIpv6(ip) : isDeniedIpv4(parseIpv4(ip) ?? 0)) {
        decision = true;
        break;
      }
    }
  }
  targetCache.set(hostname, { decision, at: Date.now() });
  return decision;
}

export async function getUpstreamUrl(reqUrl: string): Promise<string | null> {
  try {
    const url = new URL(reqUrl);
    const raw = url.searchParams.get('url');
    if (!raw) return null;
    let parsed: URL;
    try {
      parsed = new URL(raw);
    } catch {
      console.warn('getUpstreamUrl: failed to parse URL, trying decoded');
      parsed = new URL(decodeURIComponent(raw));
    }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
    if (await isDeniedTarget(parsed.hostname)) return null;
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

function parseRetryAfter(header: string | null): number | undefined {
  if (header == null) return undefined;
  if (/^\d+$/.test(header.trim())) {
    const seconds = Number.parseInt(header, 10);
    return Number.isFinite(seconds) ? seconds * 1000 : undefined;
  }
  const dateMs = Date.parse(header);
  return Number.isFinite(dateMs) ? Math.max(0, dateMs - Date.now()) : undefined;
}

function retryDelayMs(response: Response): number {
  const parsed = parseRetryAfter(response.headers.get('Retry-After'));
  return Math.min(parsed ?? FEED_RETRY_FALLBACK_MS, FEED_RETRY_MAX_MS);
}

function normalizeEtag(value: string): string {
  return value.trim().replace(/^W\//i, '');
}

function matchesEtag(header: string, etag: string | null): boolean {
  if (!etag) return false;
  return header.split(',').some((candidate) => {
    const trimmed = candidate.trim();
    return trimmed === '*' || normalizeEtag(trimmed) === normalizeEtag(etag);
  });
}

function isNotModified(entry: CachedFeed, conditional: FeedConditionalHeaders): boolean {
  if (conditional.etag) return matchesEtag(conditional.etag, entry.etag);
  if (!conditional.lastModified || !entry.lastModified) return false;
  const requestedAt = Date.parse(conditional.lastModified);
  const modifiedAt = Date.parse(entry.lastModified);
  return Number.isFinite(requestedAt) && Number.isFinite(modifiedAt) && modifiedAt <= requestedAt;
}

function responseHeaders(entry: CachedFeed, ageSeconds: number, state: FeedCacheResult['state']): Headers {
  const headers = new Headers({
    'Content-Type': 'application/xml; charset=utf-8',
    'Cache-Control': 'no-cache, no-store',
    Age: String(ageSeconds),
    'X-Sift-Cache': state,
  });
  if (entry.etag) headers.set('ETag', entry.etag);
  if (entry.lastModified) headers.set('Last-Modified', entry.lastModified);
  return headers;
}

function responseFromEntry(
  entry: CachedFeed,
  conditional: FeedConditionalHeaders,
  state: FeedCacheResult['state'],
): FeedCacheResult {
  const ageSeconds = Math.max(0, Math.floor((Date.now() - entry.fetchedAt) / 1000));
  const headers = responseHeaders(entry, ageSeconds, state);
  if (isNotModified(entry, conditional)) {
    return { response: new Response(null, { status: 304, headers }), state, ageSeconds };
  }
  return {
    response: new Response(entry.body.slice(), { status: 200, headers }),
    state,
    ageSeconds,
  };
}

const memoryFeedStore: FeedRepresentationStore = {
  async get(upstream) {
    const entry = feedCache.get(upstream);
    if (entry) touchFeedCache(upstream, entry);
    return entry;
  },
  async put(upstream, entry) {
    touchFeedCache(upstream, entry);
  },
};

function getWorkerCache(): CacheApiLike | null {
  const cacheStorage = (globalThis as typeof globalThis & { caches?: CacheStorageLike }).caches;
  return cacheStorage?.default ?? null;
}

function workerCacheKey(upstream: string): Request {
  return new Request(upstream, { method: 'GET' });
}

function workerCacheResponse(entry: CachedFeed): Response {
  const headers = new Headers({
    'Content-Type': 'application/xml; charset=utf-8',
    'Cache-Control': `public, max-age=${Math.floor(FEED_CACHE_TTL_MS / 1000)}`,
    [WORKER_FETCHED_AT_HEADER]: String(entry.fetchedAt),
  });
  if (entry.etag) headers.set('ETag', entry.etag);
  if (entry.lastModified) headers.set('Last-Modified', entry.lastModified);
  return new Response(entry.body.slice(), { status: 200, headers });
}

function workerFeedStore(cache: CacheApiLike): FeedRepresentationStore {
  return {
    async get(upstream) {
      try {
        const response = await cache.match(workerCacheKey(upstream));
        if (!response || response.status !== 200) return undefined;
        const fetchedAt = Number(response.headers.get(WORKER_FETCHED_AT_HEADER));
        if (!Number.isFinite(fetchedAt) || fetchedAt < 0) return undefined;
        if (Date.now() - fetchedAt >= FEED_CACHE_TTL_MS) return undefined;
        const body = new Uint8Array(await response.arrayBuffer());
        if (body.byteLength > FEED_CACHE_MAX_BODY_BYTES) return undefined;
        return {
          body,
          etag: response.headers.get('ETag'),
          lastModified: response.headers.get('Last-Modified'),
          fetchedAt,
        };
      } catch {
        return undefined;
      }
    },
    async put(upstream, entry) {
      try {
        await cache.put(workerCacheKey(upstream), workerCacheResponse(entry));
      } catch {
      }
    },
  };
}

async function getCachedFeed(upstream: string): Promise<CachedFeed | undefined> {
  const cache = getWorkerCache();
  if (cache) {
    const entry = await workerFeedStore(cache).get(upstream);
    if (entry) {
      await memoryFeedStore.put(upstream, entry);
      return entry;
    }
  }
  return memoryFeedStore.get(upstream);
}

async function storeCachedFeed(upstream: string, entry: CachedFeed): Promise<void> {
  await memoryFeedStore.put(upstream, entry);
  const cache = getWorkerCache();
  if (cache) await workerFeedStore(cache).put(upstream, entry);
}

function touchFeedCache(upstream: string, entry: CachedFeed): void {
  feedCache.delete(upstream);
  feedCache.set(upstream, entry);
  while (feedCache.size > FEED_CACHE_MAX_ENTRIES) {
    const oldest = feedCache.keys().next().value;
    if (oldest === undefined) break;
    feedCache.delete(oldest);
  }
}

function recordFeedRetry(upstream: string, delayMs: number): void {
  feedRetries.delete(upstream);
  feedRetries.set(upstream, Date.now() + delayMs);
  while (feedRetries.size > FEED_CACHE_MAX_ENTRIES) {
    const oldest = feedRetries.keys().next().value;
    if (oldest === undefined) break;
    feedRetries.delete(oldest);
  }
}

function cooldownResponse(upstream: string): FeedCacheResult {
  const retryAt = feedRetries.get(upstream) ?? Date.now();
  const retryAfter = Math.max(1, Math.ceil((retryAt - Date.now()) / 1000));
  return {
    response: new Response(null, {
      status: 429,
      headers: {
        'Retry-After': String(retryAfter),
        'Cache-Control': 'no-store',
        'X-Sift-Cache': 'cooldown',
      },
    }),
    state: 'cooldown',
  };
}

async function revalidateFeed(upstream: string, previous: CachedFeed | undefined): Promise<RevalidationResult> {
  const headers = new Headers();
  if (previous?.etag) headers.set('If-None-Match', previous.etag);
  if (previous?.lastModified) headers.set('If-Modified-Since', previous.lastModified);

  const response = await fetchUpstream(upstream, { headers });
  if (response.status === 304 && previous) {
    const entry: CachedFeed = {
      ...previous,
      etag: response.headers.get('ETag') ?? previous.etag,
      lastModified: response.headers.get('Last-Modified') ?? previous.lastModified,
      fetchedAt: Date.now(),
    };
    await storeCachedFeed(upstream, entry);
    feedRetries.delete(upstream);
    return { kind: 'cached', entry, state: 'revalidated' };
  }

  if (response.status === 429) {
    const delayMs = retryDelayMs(response);
    recordFeedRetry(upstream, delayMs);
    const headers = new Headers(response.headers);
    if (!headers.has('Retry-After')) headers.set('Retry-After', String(Math.ceil(delayMs / 1000)));
    return {
      kind: 'response',
      response: new Response(response.body, { status: response.status, headers }),
      state: 'bypass',
    };
  }

  if (response.status !== 200) {
    return { kind: 'response', response, state: 'bypass' };
  }

  const contentLength = Number(response.headers.get('Content-Length') ?? '');
  if (
    response.headers.has('Set-Cookie') ||
    response.headers.get('Vary')?.trim() === '*' ||
    (Number.isFinite(contentLength) && contentLength > FEED_CACHE_MAX_BODY_BYTES)
  ) {
    return { kind: 'response', response, state: 'bypass' };
  }

  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.byteLength > FEED_CACHE_MAX_BODY_BYTES) {
    return {
      kind: 'response',
      response: new Response(bytes, { status: response.status, headers: response.headers }),
      state: 'bypass',
    };
  }

  const entry: CachedFeed = {
    body: bytes,
    etag: response.headers.get('ETag'),
    lastModified: response.headers.get('Last-Modified'),
    fetchedAt: Date.now(),
  };
  await storeCachedFeed(upstream, entry);
  feedRetries.delete(upstream);
  return { kind: 'cached', entry, state: previous ? 'revalidated' : 'miss' };
}

export async function fetchFeedCached(
  upstream: string,
  conditional: FeedConditionalHeaders = {},
): Promise<FeedCacheResult> {
  const now = Date.now();
  const cached = await getCachedFeed(upstream);
  if (cached && now - cached.fetchedAt < FEED_CACHE_TTL_MS) {
    touchFeedCache(upstream, cached);
    return responseFromEntry(cached, conditional, 'hit');
  }

  const retryAt = feedRetries.get(upstream);
  if (retryAt !== undefined) {
    if (retryAt > now) return cooldownResponse(upstream);
    feedRetries.delete(upstream);
  }

  let revalidation = feedRevalidations.get(upstream);
  if (!revalidation) {
    revalidation = revalidateFeed(upstream, cached);
    feedRevalidations.set(upstream, revalidation);
  }

  try {
    const result = await revalidation;
    if (result.kind === 'response') {
      return { response: result.response, state: result.state };
    }
    return responseFromEntry(result.entry, conditional, result.state);
  } finally {
    if (feedRevalidations.get(upstream) === revalidation) feedRevalidations.delete(upstream);
  }
}

export function clearFeedCacheForTests(): void {
  feedCache.clear();
  feedRetries.clear();
}

export function badRequest(message: string): Response {
  return new Response(message, { status: 400 });
}

export function badGateway(message: string): Response {
  return new Response(message, { status: 502 });
}

export { assertNoUrlLog } from './log';
