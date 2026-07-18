import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import {
  ListToolsRequestSchema,
  CallToolRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import { Relay } from './relay';
import { fetchUpstream } from './fetch';
import { parseFeed } from '../src/feeds/parse';
import { findAlternateFeeds } from '../src/feeds/discover';
import type { Feed } from '../src/db/types';

type Discovered = {
  url: string;
  title: string;
  htmlUrl?: string;
  samples: string[];
};

const toolDefinitions = [
  {
    name: 'list_feeds',
    description: 'List all subscribed RSS feeds',
    inputSchema: { type: 'object' as const, properties: {} },
  },
  {
    name: 'get_feed',
    description: 'Get details of a specific feed by URL',
    inputSchema: {
      type: 'object' as const,
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
      type: 'object' as const,
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
      type: 'object' as const,
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
      type: 'object' as const,
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
      type: 'object' as const,
      properties: {
        url: { type: 'string', description: 'Feed URL' },
        limit: { type: 'number', description: 'Maximum items to return (default 20)' },
      },
      required: ['url'],
    },
  },
];

function textResult(content: string, isError?: boolean): CallToolResult {
  return { content: [{ type: 'text' as const, text: content }], ...(isError ? { isError: true } : {}) };
}

export function createMcpServer(relay: Relay): Server {
  const server = new Server(
    { name: 'sift-mcp', version: '0.1.0' },
    { capabilities: { tools: {} } },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: toolDefinitions,
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;

    try {
      switch (name) {
        case 'list_feeds':
          return textResult(JSON.stringify(relay.getFeeds(), null, 2));
        case 'get_feed':
          return handleGetFeed(relay, args ?? {});
        case 'discover_feed':
          return await handleDiscoverFeed(args ?? {});
        case 'add_feed':
          return await handleAddFeed(relay, args ?? {});
        case 'remove_feed':
          return await handleRemoveFeed(relay, args ?? {});
        case 'get_feed_items':
          return await handleGetFeedItems(args ?? {});
        default:
          return textResult(`Unknown tool: ${name}`, true);
      }
    } catch (err) {
      return textResult(err instanceof Error ? err.message : 'Internal error', true);
    }
  });

  return server;
}

export async function handleMcpRequest(request: Request, relay: Relay): Promise<Response> {
  const transport = new WebStandardStreamableHTTPServerTransport({
    enableJsonResponse: true,
  });
  const server = createMcpServer(relay);
  await server.connect(transport);
  return transport.handleRequest(request);
}

function handleGetFeed(relay: Relay, args: Record<string, unknown>): CallToolResult {
  const url = String(args.url ?? '');
  if (!url) return textResult('url is required', true);
  const feed = relay.getFeed(url);
  if (!feed) return textResult(`Feed not found: ${url}`, true);
  return textResult(JSON.stringify(feed, null, 2));
}

async function handleDiscoverFeed(args: Record<string, unknown>): Promise<CallToolResult> {
  const url = String(args.url ?? '');
  if (!url) return textResult('url is required', true);

  const discovered = await discover(url);
  if (!discovered) return textResult(`Could not find a feed at: ${url}`, true);
  return textResult(JSON.stringify(discovered, null, 2));
}

async function handleAddFeed(relay: Relay, args: Record<string, unknown>): Promise<CallToolResult> {
  const url = String(args.url ?? '');
  if (!url) return textResult('url is required', true);

  const discovered = await discover(url);
  if (!discovered) return textResult(`Could not find a feed at: ${url}`, true);

  const feed: Feed = {
    id: crypto.randomUUID(),
    url: discovered.url,
    title: discovered.title,
    htmlUrl: discovered.htmlUrl,
    lastFetched: null,
    learnedIntervalMs: 60 * 60 * 1000,
    lastError: null,
    lastItemPublishedAt: null,
  };

  await relay.relayAddFeed(feed);
  return textResult(JSON.stringify(feed, null, 2));
}

async function handleRemoveFeed(relay: Relay, args: Record<string, unknown>): Promise<CallToolResult> {
  const url = String(args.url ?? '');
  if (!url) return textResult('url is required', true);
  await relay.relayRemoveFeed(url);
  return textResult(`Unsubscribed from: ${url}`);
}

async function handleGetFeedItems(args: Record<string, unknown>): Promise<CallToolResult> {
  const url = String(args.url ?? '');
  if (!url) return textResult('url is required', true);
  const limit = typeof args.limit === 'number' ? args.limit : 20;

  let res: Response;
  try {
    res = await fetchUpstream(url);
  } catch {
    return textResult(`Failed to fetch feed: ${url}`, true);
  }

  if (!res.ok) return textResult(`HTTP ${res.status} fetching feed: ${url}`, true);

  const xml = await res.text();
  const parsed = parseFeed(xml);
  if (!parsed) return textResult(`Failed to parse feed XML from: ${url}`, true);

  const items = parsed.items.slice(0, limit).map((i) => ({
    title: i.title,
    link: i.link,
    author: i.author,
    publishedAt: i.publishedAt,
    excerpt: i.excerpt.slice(0, 300),
  }));

  return textResult(JSON.stringify({ title: parsed.title, items }, null, 2));
}

async function discover(url: string): Promise<Discovered | null> {
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
