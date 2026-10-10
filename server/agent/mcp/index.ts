import { Hono, type Context } from 'hono';
import pkg from '../../../package.json';
import { assertNoKeyLog } from '../../log';
import { authenticateToken, hasScope } from '../../sync/auth';
import { RATE_LIMITS, checkRateLimit } from '../../sync/ratelimit';
import { ensureSchema } from '../../sync/schema';
import { publicOrigin } from '../origin';
import { discoverTools } from './discover';
import { readTools } from './read-tools';
import { validateSchema } from './schema';
import { ToolError, type ToolContext, type ToolDefinition } from './types';
import { writeTools } from './write-tools';

export interface McpRoutesOptions {
  db: D1Database;
  pollDb?: D1Database;
  publicUrl?: string;
}

const SUPPORTED_PROTOCOL_VERSIONS = ['2025-11-25', '2025-06-18', '2025-03-26', '2024-11-05'];
const MAX_BODY_BYTES = 256 * 1024;

const TOOLS: ToolDefinition[] = [...readTools, ...discoverTools, ...writeTools];

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Authorization, Content-Type, MCP-Protocol-Version',
  'Access-Control-Expose-Headers': 'WWW-Authenticate',
  'Access-Control-Max-Age': '86400',
};

type JsonRpcId = string | number | null;

interface JsonRpcRequest {
  jsonrpc: '2.0';
  id?: JsonRpcId;
  method: string;
  params?: Record<string, unknown>;
}

const PARSE_ERROR = -32700;
const INVALID_REQUEST = -32600;
const METHOD_NOT_FOUND = -32601;
const INVALID_PARAMS = -32602;
const INTERNAL_ERROR = -32603;

function instructions(hasContent: boolean): string {
  const lines = [
    'Sift is a personal RSS reader. These tools read and manage the user\'s subscriptions, reading statistics and (where available) recent articles.',
    '',
    'Identifiers:',
    '- A feed is identified by feedId, an opaque string from list_subscriptions. Never use a feed URL as an identifier.',
    '- An item is identified by <feedId>::<guid>, as returned in the id field of list_items. Pass it back unchanged.',
    '- Feed URLs in results have credentials removed and may show REDACTED values.',
    '',
    'Workflows:',
    '- Recommend feeds: call list_subscriptions with sort "engagement" to see what the user reads most, then suggest similar feeds and verify every suggestion with discover_feeds before proposing or subscribing to it.',
    '- Find a person\'s or organisation\'s blog: call discover_feeds with their website URL. It reports the feeds it finds and whether the user already subscribes.',
  ];
  if (hasContent) {
    lines.push(
      '- Summarise recent reading: call get_reading_stats or list_subscriptions to choose feeds, then list_items (use feedIds and since), then get_item for the articles worth reading in full.',
      '- Article content covers only the last seven days of items.',
    );
  } else {
    lines.push(
      '- Summarise reading: use get_reading_stats or list_subscriptions. Article content is unavailable on this deployment, so list_items and get_item are not offered.',
    );
  }
  lines.push(
    '- Subscribe, tag, rename or unsubscribe only when the user asks. Confirm before unsubscribing. Write tools are offered only when the connection has write access.',
  );
  return lines.join('\n');
}

function rpcResult(id: JsonRpcId, result: unknown) {
  return { jsonrpc: '2.0' as const, id, result };
}

function rpcError(id: JsonRpcId, code: number, message: string) {
  return { jsonrpc: '2.0' as const, id, error: { code, message } };
}

function isRequest(value: unknown): value is JsonRpcRequest {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const message = value as Record<string, unknown>;
  return message.jsonrpc === '2.0' && typeof message.method === 'string';
}

type ToolOutcome =
  | { rpcError: { code: number; message: string }; result?: undefined }
  | { result: unknown; rpcError?: undefined };

function toolErrorResult(message: string) {
  return { content: [{ type: 'text', text: message }], isError: true };
}

export function createMcpRoutes(options: McpRoutesOptions): Hono {
  const { db, pollDb, publicUrl } = options;
  const app = new Hono();
  const hasContent = pollDb !== undefined;
  let schemaReady: Promise<void> | null = null;

  function availableTools(scopes: ToolContext['scopes']): ToolDefinition[] {
    return TOOLS.filter((tool) => hasScope(scopes, tool.scope) && (!tool.needsPoll || hasContent));
  }

  function unauthorised(c: Context, connectionId?: string): Response {
    const suffix = connectionId === undefined ? '' : `/mcp/c/${encodeURIComponent(connectionId)}`;
    const metadata = `${publicOrigin(c.req.url, publicUrl)}/.well-known/oauth-protected-resource${suffix}`;
    return c.text('Unauthorized', 401, {
      ...CORS_HEADERS,
      'WWW-Authenticate': `Bearer resource_metadata="${metadata}"`,
      'Cache-Control': 'no-store',
    });
  }

  async function callTool(ctx: ToolContext, params: Record<string, unknown> | undefined): Promise<ToolOutcome> {
    const name = params?.name;
    const tool = typeof name === 'string' ? TOOLS.find((candidate) => candidate.name === name) : undefined;
    if (!tool || (tool.needsPoll && !hasContent)) return { rpcError: { code: INVALID_PARAMS, message: 'Unknown tool.' } };
    if (!hasScope(ctx.scopes, tool.scope)) {
      return { result: toolErrorResult(`insufficient_scope: this tool requires the ${tool.scope} scope, which this connection does not have.`) };
    }
    const limit = await checkRateLimit(db, `mcp:tok:${ctx.tokenId}`, RATE_LIMITS.mcp.windowSeconds, RATE_LIMITS.mcp.limit);
    if (!limit.ok) {
      return { result: toolErrorResult(`Rate limit reached. Retry in ${limit.retryAfter} seconds.`) };
    }
    const args = params?.arguments ?? {};
    const errors = validateSchema(tool.inputSchema, args, 'arguments');
    if (errors.length > 0) return { result: toolErrorResult(`Invalid arguments: ${errors.slice(0, 5).join('; ')}`) };
    try {
      const output = await tool.run(ctx, args as Record<string, unknown>);
      return { result: { content: [{ type: 'text', text: output.text }], structuredContent: output.data } };
    } catch (error) {
      return { result: toolErrorResult(error instanceof ToolError ? error.message : 'The tool failed unexpectedly. Try again.') };
    }
  }

  async function handleMessage(ctx: ToolContext, message: JsonRpcRequest) {
    const id = message.id ?? null;
    switch (message.method) {
      case 'initialize': {
        const requested = message.params?.protocolVersion;
        const protocolVersion =
          typeof requested === 'string' && SUPPORTED_PROTOCOL_VERSIONS.includes(requested) ? requested : SUPPORTED_PROTOCOL_VERSIONS[0];
        return rpcResult(id, {
          protocolVersion,
          capabilities: { tools: { listChanged: false } },
          serverInfo: { name: 'sift', title: 'Sift', version: pkg.version },
          instructions: instructions(hasContent),
        });
      }
      case 'ping':
        return rpcResult(id, {});
      case 'tools/list':
        return rpcResult(id, {
          tools: availableTools(ctx.scopes).map((tool) => ({
            name: tool.name,
            title: tool.title,
            description: tool.description,
            inputSchema: tool.inputSchema,
            outputSchema: tool.outputSchema,
            annotations: { title: tool.title, ...tool.annotations },
          })),
        });
      case 'tools/call': {
        const outcome = await callTool(ctx, message.params);
        if (outcome.rpcError) return rpcError(id, outcome.rpcError.code, outcome.rpcError.message);
        return rpcResult(id, outcome.result);
      }
      default:
        return rpcError(id, METHOD_NOT_FOUND, 'Method not found.');
    }
  }

  async function handle(c: Context, connectionId?: string): Promise<Response> {
    const bearer = /^Bearer\s+(\S+)$/i.exec(c.req.header('Authorization') ?? '');
    if (!bearer) return unauthorised(c, connectionId);
    if (!schemaReady) schemaReady = ensureSchema(db);
    await schemaReady;
    const auth = await authenticateToken(db, bearer[1]);
    if (!auth) {
      assertNoKeyLog(bearer[1]);
      return unauthorised(c, connectionId);
    }

    const declared = Number(c.req.header('Content-Length'));
    if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) {
      return c.json(rpcError(null, INVALID_REQUEST, 'Request too large.'), 413, CORS_HEADERS);
    }
    let body: unknown;
    try {
      const raw = await c.req.text();
      if (raw.length > MAX_BODY_BYTES) return c.json(rpcError(null, INVALID_REQUEST, 'Request too large.'), 413, CORS_HEADERS);
      body = JSON.parse(raw);
    } catch {
      return c.json(rpcError(null, PARSE_ERROR, 'Parse error.'), 400, CORS_HEADERS);
    }

    const ctx: ToolContext = {
      db,
      pollDb,
      syncKey: auth.syncKey,
      tokenId: auth.tokenId,
      scopes: auth.scopes,
    };
    const headers = { ...CORS_HEADERS, 'Cache-Control': 'no-store' };
    const batch = Array.isArray(body);
    const messages: unknown[] = Array.isArray(body) ? body : [body];
    if (messages.length === 0) return c.json(rpcError(null, INVALID_REQUEST, 'Invalid request.'), 400, headers);

    const responses: unknown[] = [];
    for (const message of messages) {
      if (!isRequest(message)) {
        const looksLikeResponse =
          typeof message === 'object' && message !== null && 'jsonrpc' in message && !('method' in message) && ('result' in message || 'error' in message);
        if (!looksLikeResponse) responses.push(rpcError(null, INVALID_REQUEST, 'Invalid request.'));
        continue;
      }
      if (message.id === undefined) continue;
      try {
        responses.push(await handleMessage(ctx, message));
      } catch {
        responses.push(rpcError(message.id, INTERNAL_ERROR, 'Internal error.'));
      }
    }
    if (responses.length === 0) return new Response(null, { status: 202, headers });
    return c.json(batch ? responses : responses[0], 200, headers);
  }

  const methodNotAllowed = (c: Context) =>
    c.text('Method Not Allowed', 405, { ...CORS_HEADERS, Allow: 'POST, OPTIONS' });
  const preflight = (c: Context) => new Response(null, { status: 204, headers: CORS_HEADERS });

  app.options('/mcp', preflight);
  app.options('/mcp/c/:id', preflight);
  app.post('/mcp', (c) => handle(c));
  app.post('/mcp/c/:id', (c) => handle(c, c.req.param('id')));
  app.all('/mcp', methodNotAllowed);
  app.all('/mcp/c/:id', methodNotAllowed);

  return app;
}
