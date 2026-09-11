import { afterEach, describe, expect, it, vi } from 'vitest';
import { createMcpHttpHandler } from '../server/mcp';
import { Relay } from '../server/relay';

const PUBLIC_ORIGIN = 'http://93.184.216.34';
const ACCEPT = 'application/json, text/event-stream';

afterEach(() => {
  vi.unstubAllGlobals();
});

async function callTool(name: string, args: Record<string, unknown>): Promise<Response> {
  const handler = createMcpHttpHandler(new Relay());
  return handler.fetch(new Request('http://localhost/mcp', {
    method: 'POST',
    headers: { Accept: ACCEPT, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: { name, arguments: args },
    }),
  }));
}

describe('MCP upstream target safety', () => {
  it('rejects a private direct item-fetch URL before making a request', async () => {
    const requests: string[] = [];
    vi.stubGlobal('fetch', (async (input) => {
      requests.push(String(input));
      throw new Error('unexpected upstream request');
    }) as typeof globalThis.fetch);

    const response = await callTool('get_feed_items', { url: 'http://127.0.0.1/feed.xml' });

    expect(response.status).toBe(200);
    expect(await response.text()).toContain('Failed to fetch feed');
    expect(requests).toEqual([]);
  });

  it('does not request a private alternate-feed candidate', async () => {
    const requests: string[] = [];
    const html = '<html><head><link rel="alternate" type="application/rss+xml" href="http://127.0.0.1/private.xml"></head></html>';
    vi.stubGlobal('fetch', (async (input) => {
      requests.push(String(input));
      return new Response(html, { status: 200, headers: { 'Content-Type': 'text/html' } });
    }) as typeof globalThis.fetch);

    const response = await callTool('discover_feed', { url: `${PUBLIC_ORIGIN}/page` });

    expect(response.status).toBe(200);
    expect(await response.text()).toContain('Could not find a feed');
    expect(requests).toEqual([`${PUBLIC_ORIGIN}/page`, `${PUBLIC_ORIGIN}/page`]);
  });
});
