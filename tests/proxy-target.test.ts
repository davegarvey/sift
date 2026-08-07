/**
 * Fetch-proxy target denial (server/fetch.ts): loopback, private,
 * link-local, and metadata targets are refused — by literal IP, hostname
 * suffix, and resolved DNS records (via stubbed DoH). Public targets pass.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { getUpstreamUrl } from '../server/fetch';

function stubDoh(answers: Record<string, string[]>): void {
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = new URL(String(input));
    const name = url.searchParams.get('name') ?? '';
    const type = url.searchParams.get('type') ?? '';
    const data = answers[`${name}:${type}`] ?? [];
    return new Response(JSON.stringify({ Answer: data.map((d) => ({ data: d })) }), {
      status: 200,
      headers: { 'content-type': 'application/dns-json' },
    });
  }) as unknown as typeof globalThis.fetch;
}

function reqUrl(target: string): string {
  return `http://localhost/feed?url=${encodeURIComponent(target)}`;
}

beforeEach(() => {
  // Default: resolve everything publicly. Tests override as needed.
  stubDoh({});
});

describe('getUpstreamUrl: literal targets', () => {
  it('accepts public IPv4 and IPv6 literals', async () => {
    expect(await getUpstreamUrl(reqUrl('http://93.184.216.34/feed.xml'))).not.toBeNull();
    expect(await getUpstreamUrl(reqUrl('http://[2606:2800:220:1:248:1893:25c8:1946]/feed.xml'))).not.toBeNull();
  });

  it('refuses loopback literals (IPv4 and IPv6)', async () => {
    expect(await getUpstreamUrl(reqUrl('http://127.0.0.1/feed.xml'))).toBeNull();
    expect(await getUpstreamUrl(reqUrl('http://127.1.2.3/feed.xml'))).toBeNull();
    expect(await getUpstreamUrl(reqUrl('http://[::1]/feed.xml'))).toBeNull();
    expect(await getUpstreamUrl(reqUrl('http://[::ffff:127.0.0.1]/feed.xml'))).toBeNull();
  });

  it('refuses private, link-local, and metadata ranges', async () => {
    for (const host of ['10.0.0.5', '172.16.0.1', '172.31.255.254', '192.168.1.1', '169.254.169.254', '100.64.0.1', '0.0.0.0']) {
      expect(await getUpstreamUrl(reqUrl(`http://${host}/feed.xml`))).toBeNull();
    }
    for (const host of ['[fc00::1]', '[fd12:3456:789a::1]', '[fe80::1]', '[::]']) {
      expect(await getUpstreamUrl(reqUrl(`http://${host}/feed.xml`))).toBeNull();
    }
  });

  it('refuses localhost and private hostname suffixes', async () => {
    expect(await getUpstreamUrl(reqUrl('http://localhost/feed.xml'))).toBeNull();
    expect(await getUpstreamUrl(reqUrl('http://localhost.localdomain/feed.xml'))).toBeNull();
    expect(await getUpstreamUrl(reqUrl('http://router.internal/feed.xml'))).toBeNull();
    expect(await getUpstreamUrl(reqUrl('http://printer.local/feed.xml'))).toBeNull();
  });
});

describe('getUpstreamUrl: resolved DNS records', () => {
  it('refuses a hostname that resolves to a private address', async () => {
    stubDoh({ 'localtest.me:A': ['127.0.0.1'], 'localtest.me:AAAA': [] });
    expect(await getUpstreamUrl(reqUrl('http://localtest.me/feed.xml'))).toBeNull();
  });

  it('refuses when any resolved record is private (mixed answers)', async () => {
    stubDoh({
      'mixed.example:A': ['93.184.216.34', '10.0.0.9'],
      'mixed.example:AAAA': [],
    });
    expect(await getUpstreamUrl(reqUrl('http://mixed.example/feed.xml'))).toBeNull();
  });

  it('accepts a hostname that resolves only to public addresses', async () => {
    stubDoh({
      'example.com:A': ['93.184.216.34'],
      'example.com:AAAA': ['2606:2800:220:1:248:1893:25c8:1946'],
    });
    expect(await getUpstreamUrl(reqUrl('http://example.com/feed.xml'))).toBe(
      'http://example.com/feed.xml',
    );
  });

  it('fails closed when the DoH resolution errors', async () => {
    globalThis.fetch = (async () => {
      throw new Error('dns down');
    }) as unknown as typeof globalThis.fetch;
    expect(await getUpstreamUrl(reqUrl('http://unresolvable.example/feed.xml'))).toBeNull();
  });

  it('fails closed when DoH returns a non-OK status', async () => {
    globalThis.fetch = (async () => new Response('boom', { status: 500 })) as unknown as typeof globalThis.fetch;
    expect(await getUpstreamUrl(reqUrl('http://unresolvable.example/feed.xml'))).toBeNull();
  });
});
