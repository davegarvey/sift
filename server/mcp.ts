import { fetchUpstream } from './fetch';
import { Relay } from './relay';
import { parseFeed, parsedToItems } from '../src/feeds/parse';
import { findAlternateFeeds } from '../src/feeds/discover';
import type { Feed } from '../src/db/types';

const PROTOCOL_VERSION = '2024-11-05';
const SERVER_NAME = 'sift-mcp';
const SERVER_VERSION = '0.1.0';

type JsonRpcRequest = {
  jsonrpc: '2.0';
  id?: number | string;
  method: string;
  params?: Record<string, unknown>;
};

type JsonRpcResponse = {
  jsonrpc: '2.0';
  id: number | string | null;
} & ({ result: unknown } | { error: { code: number; message: string; data?: unknown } });

type McpConn = {
  controller: ReadableStreamDefaultController;
};

const toolDefinitions = [
  {
    name: 'list_feeds',
    description: 'List all subscribed RSS feeds',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'get_feed',
    description: 'Get details of a specific feed by URL',
    inputSchema: {
      type: 'object',
      properties: {
        url: { type: 'string', description: 'Feed URL' },
      },
      required: ['url'],
    },
  },
  {
    name: 'discover_feed',
    description: 'Check if a URL is a valid RSS/Atom feed and return a preview without subscribing',
    inputSchema: {
      type: 'object',
      properties: {
        url: { type: 'string', description: 'URL to check' },
      },
      required: ['url'],
    },
  },
  {
    name: 'add_feed',
    description: 'Subscribe to an RSS/Atom feed by URL. Auto-discovers if the URL is a web page with feed links.',
    inputSchema: {
      type: 'object',
      properties: {
        url: { type: 'string', description: 'Feed or website URL' },
      },
      required: ['url'],
    },
  },
  {
    name: 'remove_feed',
    description: 'Unsubscribe from a feed by URL',
    inputSchema: {
      type: 'object',
      properties: {
        url: { type: 'string', description: 'Feed URL' },
      },
      required: ['url'],
    },
  },
  {
    name: 'get_feed_items',
    description: 'Fetch the latest items from a feed',
    inputSchema: {
      type: 'object',
      properties: {
        url: { type: 'string', description: 'Feed URL' },
        limit: { type: 'number', description: 'Maximum items to return (default 20)' },
      },
      required: ['url'],
    },
  },
];

type Discovered = {
  url: string;
  title: string;
  htmlUrl?: string;
  samples: string[];
};

export class McpHandler {
  private relay: Relay;
  private conns = new Map<string, McpConn>();
  private nextSession = 1;

  constructor(relay: Relay) {
    this.relay = relay;
  }

  handleSse(): Response {
    const sessionId = String(this.nextSession++);
    const conns = this.conns;
    let started = false;

    const stream = new ReadableStream({
      start(controller) {
        started = true;
        const conn: McpConn = { controller };
        conns.set(sessionId, conn);
        const endpoint = `/mcp/message?sessionId=${sessionId}`;
        controller.enqueue(new TextEncoder().encode(`event: endpoint\ndata: ${endpoint}\n\n`));
      },
      cancel() {
        if (started) conns.delete(sessionId);
      },
    });

    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
      },
    });
  }

  async handleMessage(sessionId: string, body: unknown): Promise<Response> {
    const conn = this.conns.get(sessionId);
    if (!conn) {
      return new Response(JSON.stringify({ error: 'Invalid session' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const req = body as JsonRpcRequest;
    if (req.jsonrpc !== '2.0') {
      await this.sendResponse(conn, {
        jsonrpc: '2.0',
        id: req.id ?? null,
        error: { code: -32600, message: 'Invalid Request: must use JSON-RPC 2.0' },
      });
      return new Response(null, { status: 202 });
    }

    try {
      const result = await this.dispatch(req);
      await this.sendResponse(conn, {
        jsonrpc: '2.0',
        id: req.id ?? null,
        result,
      });
    } catch (err) {
      await this.sendResponse(conn, {
        jsonrpc: '2.0',
        id: req.id ?? null,
        error: {
          code: -32603,
          message: err instanceof Error ? err.message : 'Internal error',
        },
      });
    }

    return new Response(null, { status: 202 });
  }

  private async sendResponse(conn: McpConn, msg: JsonRpcResponse): Promise<void> {
    const text = `data: ${JSON.stringify(msg)}\n\n`;
    conn.controller.enqueue(new TextEncoder().encode(text));
  }

  private async dispatch(req: JsonRpcRequest): Promise<unknown> {
    switch (req.method) {
      case 'initialize':
        return this.handleInitialize(req.params);
      case 'notifications/initialized':
        return undefined;
      case 'tools/list':
        return this.handleListTools();
      case 'tools/call':
        return this.handleCallTool(req.params);
      default:
        throw new Error(`Unknown method: ${req.method}`);
    }
  }

  private handleInitialize(_params?: Record<string, unknown>): unknown {
    return {
      protocolVersion: PROTOCOL_VERSION,
      capabilities: { tools: {} },
      serverInfo: { name: SERVER_NAME, version: SERVER_VERSION },
    };
  }

  private handleListTools(): unknown {
    return { tools: toolDefinitions };
  }

  private async handleCallTool(params?: Record<string, unknown>): Promise<unknown> {
    if (!params || typeof params.name !== 'string') {
      throw new Error('Missing tool name');
    }

    const name = params.name;
    const args = (params.arguments as Record<string, unknown>) ?? {};

    switch (name) {
      case 'list_feeds':
        return this.callListFeeds();
      case 'get_feed':
        return this.callGetFeed(args);
      case 'discover_feed':
        return this.callDiscoverFeed(args);
      case 'add_feed':
        return this.callAddFeed(args);
      case 'remove_feed':
        return this.callRemoveFeed(args);
      case 'get_feed_items':
        return this.callGetFeedItems(args);
      default:
        throw new Error(`Unknown tool: ${name}`);
    }
  }

  private callListFeeds(): unknown {
    const feeds = this.relay.getFeeds();
    return { content: [{ type: 'text', text: JSON.stringify(feeds, null, 2) }] };
  }

  private callGetFeed(args: Record<string, unknown>): unknown {
    const url = String(args.url ?? '');
    if (!url) throw new Error('url is required');
    const feed = this.relay.getFeed(url);
    if (!feed) {
      return { content: [{ type: 'text', text: `Feed not found: ${url}` }], isError: true };
    }
    return { content: [{ type: 'text', text: JSON.stringify(feed, null, 2) }] };
  }

  private async callDiscoverFeed(args: Record<string, unknown>): Promise<unknown> {
    const url = String(args.url ?? '');
    if (!url) throw new Error('url is required');

    const discovered = await this.discover(url);
    if (!discovered) {
      return { content: [{ type: 'text', text: `Could not find a feed at: ${url}` }], isError: true };
    }
    return {
      content: [{ type: 'text', text: JSON.stringify(discovered, null, 2) }],
    };
  }

  private async callAddFeed(args: Record<string, unknown>): Promise<unknown> {
    const url = String(args.url ?? '');
    if (!url) throw new Error('url is required');

    const discovered = await this.discover(url);
    if (!discovered) {
      return { content: [{ type: 'text', text: `Could not find a feed at: ${url}` }], isError: true };
    }

    const feed: Feed = {
      url: discovered.url,
      title: discovered.title,
      htmlUrl: discovered.htmlUrl,
      lastFetched: null,
      learnedIntervalMs: 60 * 60 * 1000,
      lastError: null,
      lastItemPublishedAt: null,
    };

    await this.relay.relayAddFeed(feed);
    return { content: [{ type: 'text', text: JSON.stringify(feed, null, 2) }] };
  }

  private async callRemoveFeed(args: Record<string, unknown>): Promise<unknown> {
    const url = String(args.url ?? '');
    if (!url) throw new Error('url is required');
    await this.relay.relayRemoveFeed(url);
    return { content: [{ type: 'text', text: `Unsubscribed from: ${url}` }] };
  }

  private async callGetFeedItems(args: Record<string, unknown>): Promise<unknown> {
    const url = String(args.url ?? '');
    if (!url) throw new Error('url is required');
    const limit = typeof args.limit === 'number' ? args.limit : 20;

    let res: Response;
    try {
      res = await fetchUpstream(url);
    } catch {
      return { content: [{ type: 'text', text: `Failed to fetch feed: ${url}` }], isError: true };
    }

    if (!res.ok) {
      return { content: [{ type: 'text', text: `HTTP ${res.status} fetching feed: ${url}` }], isError: true };
    }

    const xml = await res.text();
    const parsed = parseFeed(xml);
    if (!parsed) {
      return { content: [{ type: 'text', text: `Failed to parse feed XML from: ${url}` }], isError: true };
    }

    const items = parsed.items.slice(0, limit).map((i) => ({
      title: i.title,
      link: i.link,
      author: i.author,
      publishedAt: i.publishedAt,
      excerpt: i.excerpt.slice(0, 300),
    }));

    return { content: [{ type: 'text', text: JSON.stringify({ title: parsed.title, items }, null, 2) }] };
  }

  private async discover(url: string): Promise<Discovered | null> {
    const direct = await tryParse(url);
    if (direct) return { url, title: direct.title, htmlUrl: direct.htmlUrl, samples: firstThree(direct) };

    let html: string;
    try {
      const res = await fetchUpstream(url);
      if (!res.ok) return null;
      html = await res.text();
    } catch {
      return null;
    }

    const candidates = findAlternateFeeds(html, url);
    for (const candidate of candidates) {
      const parsed = await tryParse(candidate);
      if (parsed) {
        return { url: candidate, title: parsed.title, htmlUrl: parsed.htmlUrl, samples: firstThree(parsed) };
      }
    }

    return null;
  }
}

async function tryParse(url: string) {
  let res: Response;
  try {
    res = await fetchUpstream(url);
  } catch {
    return null;
  }
  if (!res.ok) return null;
  const xml = await res.text();
  return parseFeed(xml);
}

function firstThree(parsed: { items: { title: string }[] }): string[] {
  return parsed.items.slice(0, 3).map((i) => i.title);
}
