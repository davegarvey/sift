import { clearSharedFeedFailure, getSharedFeedFailure, recordSharedFeedFailure } from './feed-state';
import { fetchOriginRequest, type OriginPolicyOptions } from './origin-governor';
import { sha256Hex } from './sync/tokens';

export const UPSTREAM_TIMEOUT_MS = 15_000;
export const READER_USER_AGENT = 'sift/0.0 (+https://github.com/dave/sift)';
export const FEED_CACHE_TTL_MS = 15 * 60_000;
export const FEED_CACHE_MAX_FRESHNESS_MS = 24 * 60 * 60_000;
export const FEED_STALE_RETENTION_MS = 24 * 60 * 60_000;
export const FEED_CACHE_MAX_ENTRIES = 256;
export const FEED_CACHE_MAX_BODY_BYTES = 2 * 1024 * 1024;
export const FEED_RETRY_FALLBACK_MS = 30 * 60_000;
export const FEED_RETRY_MAX_MS = 24 * 60 * 60_000;

const DENY_HOST_SUFFIXES = ['.localhost', '.localdomain', '.local', '.internal'];
const DOH_URL = 'https://cloudflare-dns.com/dns-query';
const DOH_TIMEOUT_MS = 5_000;
const TARGET_CACHE_TTL_MS = 5 * 60_000;
const MAX_REDIRECTS = 5;
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);
const TRANSIENT_FAILURE_STATUSES = new Set([408, 419, 425, 429]);
const FEED_HINT_SCAN_BYTES = 64 * 1024;
const SYNDICATION_PERIOD_MS: Record<string, number> = {
  hourly: 60 * 60_000,
  daily: 24 * 60 * 60_000,
  weekly: 7 * 24 * 60 * 60_000,
  monthly: 30 * 24 * 60 * 60_000,
  yearly: 365 * 24 * 60 * 60_000,
};

const targetCache = new Map<string, { decision: boolean; at: number }>();

interface CachedFeed {
  body: Uint8Array;
  etag: string | null;
  lastModified: string | null;
  fetchedAt: number;
  freshUntil: number;
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
  state: 'hit' | 'miss' | 'revalidated' | 'stale' | 'cooldown' | 'bypass';
  ageSeconds?: number;
}

type RevalidationResult =
  | { kind: 'cached'; entry: CachedFeed; state: 'miss' | 'revalidated' }
  | { kind: 'response'; response: Response; state: 'bypass'; retryAt?: number };

const WORKER_FETCHED_AT_HEADER = 'X-Sift-Cache-Fetched-At';
const WORKER_RETRY_AT_HEADER = 'X-Sift-Cache-Retry-At';
const WORKER_FRESH_UNTIL_HEADER = 'X-Sift-Cache-Fresh-Until';
const feedCache = new Map<string, CachedFeed>();
const feedRevalidations = new Map<string, Promise<RevalidationResult>>();
const upstreamRequests = new Map<string, Promise<Response>>();
const databaseIds = new WeakMap<D1Database, number>();
let nextDatabaseId = 1;

interface FeedRetry {
  status: number;
  retryAt: number;
}

const feedRetries = new Map<string, FeedRetry>();

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

interface ResolvedAddress {
  type: 1 | 28;
  address: string;
}

async function resolveHost(hostname: string, signal?: AbortSignal): Promise<ResolvedAddress[] | null> {
  const controller = new AbortController();
  const abort = () => controller.abort();
  if (signal?.aborted) {
    controller.abort();
  } else {
    signal?.addEventListener('abort', abort, { once: true });
  }
  const timer = setTimeout(() => controller.abort(), DOH_TIMEOUT_MS);
  try {
    const [a, aaaa] = await Promise.all([
      fetch(`${DOH_URL}?name=${encodeURIComponent(hostname)}&type=A`, {
        headers: { accept: 'application/dns-json' },
        redirect: 'manual',
        signal: controller.signal,
      }),
      fetch(`${DOH_URL}?name=${encodeURIComponent(hostname)}&type=AAAA`, {
        headers: { accept: 'application/dns-json' },
        redirect: 'manual',
        signal: controller.signal,
      }),
    ]);
    const results: ResolvedAddress[] = [];
    for (const res of [a, aaaa]) {
      if (!res.ok) return null;
      const data = (await res.json()) as { Answer?: unknown };
      if (data.Answer !== undefined && !Array.isArray(data.Answer)) return null;
      for (const answer of data.Answer ?? []) {
        if (answer === null || typeof answer !== 'object' || Array.isArray(answer)) return null;
        const ans = answer as { type?: unknown; data?: unknown };
        if (ans.type !== 1 && ans.type !== 28) continue;
        if (typeof ans.data !== 'string') return null;
        results.push({ type: ans.type, address: ans.data });
      }
    }
    return results;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', abort);
  }
}

async function isDeniedTarget(hostname: string, signal?: AbortSignal): Promise<boolean> {
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
  const ips = await resolveHost(hostname, signal);
  // Fail closed: an unresolvable DoH result refuses the target.
  let decision = true;
  if (ips !== null && ips.length > 0) {
    decision = false;
    for (const ip of ips) {
      const denied = ip.type === 1
        ? (() => {
          const value = parseIpv4(ip.address);
          return value === null || isDeniedIpv4(value);
        })()
        : ipv6Groups(ip.address) === null || isDeniedIpv6(ip.address);
      if (denied) {
        decision = true;
        break;
      }
    }
  }
  targetCache.set(hostname, { decision, at: Date.now() });
  return decision;
}

function parseUpstreamUrl(raw: string): URL | null {
  try {
    return new URL(raw);
  } catch {
    try {
      console.warn('getUpstreamUrl: failed to parse URL, trying decoded');
      return new URL(decodeURIComponent(raw));
    } catch {
      return null;
    }
  }
}

export async function validateUpstreamUrl(raw: string, signal?: AbortSignal): Promise<string | null> {
  const parsed = parseUpstreamUrl(raw);
  if (!parsed) return null;
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
  if (await isDeniedTarget(parsed.hostname, signal)) return null;
  return parsed.toString();
}

export async function getUpstreamUrl(reqUrl: string): Promise<string | null> {
  try {
    const url = new URL(reqUrl);
    const raw = url.searchParams.get('url');
    if (!raw) return null;
    return await validateUpstreamUrl(raw);
  } catch {
    return null;
  }
}

async function cancelResponse(response: Response): Promise<void> {
  try {
    await response.body?.cancel();
  } catch {
  }
}

export async function fetchUpstream(upstream: string, init: RequestInit = {}): Promise<Response> {
  return fetchUpstreamWithPolicy(upstream, init, { route: 'feed' });
}

export function fetchUpstreamWithPolicy(
  upstream: string,
  init: RequestInit = {},
  policy: OriginPolicyOptions = { route: 'feed' },
): Promise<Response> {
  const headers = new Headers(init.headers);
  headers.set('User-Agent', READER_USER_AGENT);
  const key = upstreamCoalescingKey(upstream, init, headers, policy.db);
  if (!key) return performUpstreamWithPolicy(upstream, init, headers, policy);

  const existing = upstreamRequests.get(key);
  if (existing) return existing.then((response) => response.clone());

  const request = performUpstreamWithPolicy(upstream, init, headers, policy).then((response) => response.clone());
  upstreamRequests.set(key, request);
  return request.then((response) => response.clone()).finally(() => {
    if (upstreamRequests.get(key) === request) upstreamRequests.delete(key);
  });
}

function databaseId(db: D1Database): number {
  let id = databaseIds.get(db);
  if (id === undefined) {
    id = nextDatabaseId++;
    databaseIds.set(db, id);
  }
  return id;
}

function upstreamCoalescingKey(
  upstream: string,
  init: RequestInit,
  headers: Headers,
  db?: D1Database,
): string | null {
  const method = (init.method ?? 'GET').toUpperCase();
  if (method !== 'GET' || init.body != null) return null;
  let url: string;
  try {
    url = new URL(upstream).href;
  } catch {
    return null;
  }
  const headerPairs = Array.from(headers.entries()).sort(([a], [b]) => a.localeCompare(b));
  return JSON.stringify([
    url,
    method,
    headerPairs,
    init.cache ?? null,
    init.credentials ?? null,
    init.mode ?? null,
    init.referrer ?? null,
    init.integrity ?? null,
    db ? databaseId(db) : 0,
  ]);
}

async function performUpstreamWithPolicy(
  upstream: string,
  init: RequestInit,
  headers: Headers,
  policy: OriginPolicyOptions,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), UPSTREAM_TIMEOUT_MS);
  try {
    let current = await validateUpstreamUrl(upstream, controller.signal);
    if (!current) throw new Error('Unsafe upstream URL');

    for (let redirects = 0; ; redirects += 1) {
      const response = await fetchOriginRequest(current, {
        ...init,
        headers,
        redirect: 'manual',
        signal: controller.signal,
      }, policy);
      if (response.status === 304 || response.status < 300 || response.status >= 400) {
        return response;
      }
      if (!REDIRECT_STATUSES.has(response.status) || redirects >= MAX_REDIRECTS) {
        await cancelResponse(response);
        throw new Error('Unsafe or excessive upstream redirect');
      }

      const location = response.headers.get('Location');
      if (!location) {
        await cancelResponse(response);
        throw new Error('Upstream redirect has no location');
      }
      let next: string;
      try {
        next = new URL(location, current).toString();
      } catch {
        await cancelResponse(response);
        throw new Error('Upstream redirect has an invalid location');
      }
      await cancelResponse(response);
      current = await validateUpstreamUrl(next, controller.signal);
      if (!current) throw new Error('Unsafe upstream redirect');
    }
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
  if (response.status === 429 || response.status === 419) {
    return parsed ?? FEED_RETRY_FALLBACK_MS;
  }
  return Math.min(parsed ?? FEED_RETRY_FALLBACK_MS, FEED_RETRY_MAX_MS);
}

function isUpstreamFailureStatus(status: number): boolean {
  return status >= 400 && status <= 599;
}

function isTransientFailureStatus(status: number): boolean {
  return TRANSIENT_FAILURE_STATUSES.has(status) || (status >= 500 && status <= 599);
}

function headerFreshnessMs(headers: Headers): number | undefined {
  const cacheControl = headers.get('Cache-Control') ?? '';
  const directive = (name: string): number | undefined => {
    const match = new RegExp(`(?:^|,)\\s*${name}\\s*=\\s*"?(\\d+)"?`, 'i').exec(cacheControl);
    return match ? Number(match[1]) * 1000 : undefined;
  };
  const maxAge = directive('s-maxage') ?? directive('max-age');
  if (maxAge !== undefined) return maxAge;
  const expires = headers.get('Expires');
  if (!expires) return undefined;
  const expiresAt = Date.parse(expires);
  if (!Number.isFinite(expiresAt)) return undefined;
  const date = Date.parse(headers.get('Date') ?? '');
  return expiresAt - (Number.isFinite(date) ? date : Date.now());
}

function bodyFreshnessMs(body: Uint8Array): number | undefined {
  const text = new TextDecoder().decode(body.subarray(0, FEED_HINT_SCAN_BYTES));
  const hints: number[] = [];
  const ttl = /<ttl>\s*(\d+)\s*<\/ttl>/i.exec(text);
  if (ttl) hints.push(Number(ttl[1]) * 60_000);
  const period = /<sy:updatePeriod>\s*([a-z]+)\s*<\/sy:updatePeriod>/i.exec(text);
  const periodMs = period ? SYNDICATION_PERIOD_MS[period[1].toLowerCase()] : undefined;
  if (periodMs !== undefined) {
    const frequency = /<sy:updateFrequency>\s*(\d+)\s*<\/sy:updateFrequency>/i.exec(text);
    const perPeriod = frequency ? Number(frequency[1]) : 1;
    if (perPeriod > 0) hints.push(periodMs / perPeriod);
  }
  return hints.length > 0 ? Math.max(...hints) : undefined;
}

export function feedFreshnessMs(headers: Headers, body: Uint8Array): number {
  const hints = [headerFreshnessMs(headers), bodyFreshnessMs(body)]
    .filter((hint): hint is number => hint !== undefined && Number.isFinite(hint));
  return Math.min(Math.max(FEED_CACHE_TTL_MS, ...hints), FEED_CACHE_MAX_FRESHNESS_MS);
}

function isRetained(entry: CachedFeed, now: number): boolean {
  return now < entry.freshUntil + FEED_STALE_RETENTION_MS;
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
    'X-Sift-Request-Source': 'feed-cache',
  });
  if (entry.etag) headers.set('ETag', entry.etag);
  if (entry.lastModified) headers.set('Last-Modified', entry.lastModified);
  return headers;
}

function responseFromEntry(
  entry: CachedFeed,
  conditional: FeedConditionalHeaders,
  state: FeedCacheResult['state'],
  retryAt?: number,
): FeedCacheResult {
  const ageSeconds = Math.max(0, Math.floor((Date.now() - entry.fetchedAt) / 1000));
  const headers = responseHeaders(entry, ageSeconds, state);
  if (retryAt !== undefined) {
    headers.set('X-Sift-Retry-After', String(Math.max(1, Math.ceil((retryAt - Date.now()) / 1000))));
  }
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
    if (!entry) return undefined;
    if (!isRetained(entry, Date.now())) {
      feedCache.delete(upstream);
      return undefined;
    }
    touchFeedCache(upstream, entry);
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

async function workerFailureKey(upstream: string): Promise<Request> {
  const key = await sha256Hex(upstream);
  return new Request(`https://sift.invalid/__feed_failures/${key}`, { method: 'GET' });
}

function workerCacheResponse(entry: CachedFeed): Response {
  const retainSeconds = Math.max(1, Math.ceil((entry.freshUntil + FEED_STALE_RETENTION_MS - Date.now()) / 1000));
  const headers = new Headers({
    'Content-Type': 'application/xml; charset=utf-8',
    'Cache-Control': `public, max-age=${retainSeconds}`,
    [WORKER_FETCHED_AT_HEADER]: String(entry.fetchedAt),
    [WORKER_FRESH_UNTIL_HEADER]: String(entry.freshUntil),
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
        const freshUntil = Number(response.headers.get(WORKER_FRESH_UNTIL_HEADER));
        if (!Number.isFinite(fetchedAt) || fetchedAt < 0) return undefined;
        if (!response.headers.has(WORKER_FRESH_UNTIL_HEADER) || !Number.isFinite(freshUntil)) return undefined;
        const body = new Uint8Array(await response.arrayBuffer());
        if (body.byteLength > FEED_CACHE_MAX_BODY_BYTES) return undefined;
        const entry: CachedFeed = {
          body,
          etag: response.headers.get('ETag'),
          lastModified: response.headers.get('Last-Modified'),
          fetchedAt,
          freshUntil,
        };
        return isRetained(entry, Date.now()) ? entry : undefined;
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

function recordFeedRetry(upstream: string, retry: FeedRetry): void {
  feedRetries.delete(upstream);
  feedRetries.set(upstream, retry);
  while (feedRetries.size > FEED_CACHE_MAX_ENTRIES) {
    const oldest = feedRetries.keys().next().value;
    if (oldest === undefined) break;
    feedRetries.delete(oldest);
  }
}

function cooldownResponse(retry: FeedRetry): FeedCacheResult {
  const retryAfter = Math.max(1, Math.ceil((retry.retryAt - Date.now()) / 1000));
  const headers = new Headers({
    'Retry-After': String(retryAfter),
    'Cache-Control': 'no-store',
    'X-Sift-Cache': 'cooldown',
    'X-Sift-Request-Source': 'url-cooldown',
  });
  return {
    response: new Response(null, {
      status: retry.status,
      headers,
    }),
    state: 'cooldown',
  };
}

function workerFailureResponse(retry: FeedRetry): Response {
  const retryAfter = Math.max(1, Math.ceil((retry.retryAt - Date.now()) / 1000));
  return new Response(null, {
    status: retry.status,
    headers: {
      'Cache-Control': `public, max-age=${retryAfter}`,
      [WORKER_RETRY_AT_HEADER]: String(retry.retryAt),
    },
  });
}

async function getWorkerFeedRetry(cache: CacheApiLike, upstream: string): Promise<FeedRetry | undefined> {
  try {
    const response = await cache.match(await workerFailureKey(upstream));
    if (!response || !isUpstreamFailureStatus(response.status)) return undefined;
    const retryAt = Number(response.headers.get(WORKER_RETRY_AT_HEADER));
    if (!Number.isFinite(retryAt) || retryAt <= Date.now()) return undefined;
    return { status: response.status, retryAt };
  } catch {
    return undefined;
  }
}

async function storeFeedRetry(upstream: string, retry: FeedRetry): Promise<void> {
  const cache = getWorkerCache();
  if (!cache) return;
  try {
    await cache.put(await workerFailureKey(upstream), workerFailureResponse(retry));
  } catch {
  }
}

async function rememberFeedRetry(upstream: string, retry: FeedRetry, db?: D1Database): Promise<void> {
  recordFeedRetry(upstream, retry);
  await storeFeedRetry(upstream, retry);
  if (db) {
    try {
      await recordSharedFeedFailure(db, upstream, retry);
    } catch {
    }
  }
}

async function clearFeedRetry(upstream: string, db?: D1Database): Promise<void> {
  const hadRetry = feedRetries.delete(upstream);
  if (db && hadRetry) {
    try {
      await clearSharedFeedFailure(db, upstream);
    } catch {
    }
  }
}

async function revalidateFeed(
  upstream: string,
  previous: CachedFeed | undefined,
  db?: D1Database,
): Promise<RevalidationResult> {
  const headers = new Headers();
  if (previous?.etag) headers.set('If-None-Match', previous.etag);
  if (previous?.lastModified) headers.set('If-Modified-Since', previous.lastModified);

  let response: Response;
  try {
    response = await fetchUpstreamWithPolicy(upstream, { headers }, { db, route: 'feed' });
  } catch {
    const retry: FeedRetry = {
      status: 502,
      retryAt: Date.now() + FEED_RETRY_FALLBACK_MS,
    };
    await rememberFeedRetry(upstream, retry, db);
    return {
      kind: 'response',
      response: new Response(null, {
        status: retry.status,
        headers: { 'Cache-Control': 'no-store', 'X-Sift-Request-Source': 'local-gate' },
      }),
      state: 'bypass',
      retryAt: retry.retryAt,
    };
  }
  if (response.status === 304 && previous) {
    const fetchedAt = Date.now();
    const entry: CachedFeed = {
      ...previous,
      etag: response.headers.get('ETag') ?? previous.etag,
      lastModified: response.headers.get('Last-Modified') ?? previous.lastModified,
      fetchedAt,
      freshUntil: fetchedAt + feedFreshnessMs(response.headers, previous.body),
    };
    await storeCachedFeed(upstream, entry);
    await clearFeedRetry(upstream, db);
    return { kind: 'cached', entry, state: 'revalidated' };
  }

  if (isUpstreamFailureStatus(response.status)) {
    const delayMs = retryDelayMs(response);
    const retry: FeedRetry = {
      status: response.status,
      retryAt: Date.now() + delayMs,
    };
    await rememberFeedRetry(upstream, retry, db);
    const headers = new Headers(response.headers);
    if ((response.status === 429 || response.status === 419 || response.status === 503) && !headers.has('Retry-After')) {
      headers.set('Retry-After', String(Math.ceil(delayMs / 1000)));
    }
    return {
      kind: 'response',
      response: new Response(response.body, { status: response.status, headers }),
      state: 'bypass',
      retryAt: retry.retryAt,
    };
  }

  if (response.status !== 200) {
    return { kind: 'response', response, state: 'bypass' };
  }

  const contentLength = Number(response.headers.get('Content-Length') ?? '');
  if (Number.isFinite(contentLength) && contentLength > FEED_CACHE_MAX_BODY_BYTES) {
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

  const fetchedAt = Date.now();
  const entry: CachedFeed = {
    body: bytes,
    etag: response.headers.get('ETag'),
    lastModified: response.headers.get('Last-Modified'),
    fetchedAt,
    freshUntil: fetchedAt + feedFreshnessMs(response.headers, bytes),
  };
  await storeCachedFeed(upstream, entry);
  await clearFeedRetry(upstream, db);
  return { kind: 'cached', entry, state: previous ? 'revalidated' : 'miss' };
}

export async function fetchFeedCached(
  upstream: string,
  conditional: FeedConditionalHeaders = {},
  db?: D1Database,
): Promise<FeedCacheResult> {
  const now = Date.now();
  const cached = await getCachedFeed(upstream);
  if (cached && now < cached.freshUntil) {
    return responseFromEntry(cached, conditional, 'hit');
  }

  const duringCooldown = (retry: FeedRetry): FeedCacheResult =>
    cached && isTransientFailureStatus(retry.status)
      ? responseFromEntry(cached, conditional, 'stale', retry.retryAt)
      : cooldownResponse(retry);

  const retryAt = feedRetries.get(upstream);
  if (retryAt !== undefined) {
    if (retryAt.retryAt > now) return duringCooldown(retryAt);
    feedRetries.delete(upstream);
  }

  const workerCache = getWorkerCache();
  const workerRetry = workerCache ? await getWorkerFeedRetry(workerCache, upstream) : undefined;
  if (workerRetry) {
    recordFeedRetry(upstream, workerRetry);
    return duringCooldown(workerRetry);
  }

  if (db) {
    try {
      const sharedRetry = await getSharedFeedFailure(db, upstream, now);
      if (sharedRetry) {
        recordFeedRetry(upstream, sharedRetry);
        return duringCooldown(sharedRetry);
      }
    } catch {
    }
  }

  let revalidation = feedRevalidations.get(upstream);
  if (!revalidation) {
    revalidation = revalidateFeed(upstream, cached, db);
    feedRevalidations.set(upstream, revalidation);
  }

  try {
    const result = await revalidation;
    if (result.kind === 'response') {
      if (cached && isTransientFailureStatus(result.response.status)) {
        return responseFromEntry(cached, conditional, 'stale', result.retryAt ?? feedRetries.get(upstream)?.retryAt);
      }
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
  feedRevalidations.clear();
}

export function badRequest(message: string): Response {
  return new Response(message, {
    status: 400,
    headers: { 'Cache-Control': 'no-store' },
  });
}

export function badGateway(message: string): Response {
  return new Response(message, {
    status: 502,
    headers: { 'Cache-Control': 'no-store', 'X-Sift-Request-Source': 'local-gate' },
  });
}

export { assertNoUrlLog } from './log';
