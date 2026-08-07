export const UPSTREAM_TIMEOUT_MS = 15_000;
export const READER_USER_AGENT = 'sift/0.0 (+https://github.com/dave/sift)';

const DENY_HOST_SUFFIXES = ['.localhost', '.localdomain', '.local', '.internal'];
const DOH_URL = 'https://cloudflare-dns.com/dns-query';
const DOH_TIMEOUT_MS = 5_000;
const TARGET_CACHE_TTL_MS = 5 * 60_000;

const targetCache = new Map<string, { decision: boolean; at: number }>();

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
        const data = (await res.json()) as { Answer?: { data?: string }[] };
        for (const ans of data.Answer ?? []) {
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

export function badRequest(message: string): Response {
  return new Response(message, { status: 400 });
}

export function badGateway(message: string): Response {
  return new Response(message, { status: 502 });
}

export { assertNoUrlLog } from './log';
