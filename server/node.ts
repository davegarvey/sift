import { createApp } from './handle.ts';
import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { Relay } from './relay';
import { loadEnv } from './env';
import { nodeClientIp } from './node-client-ip';
import { parseTrustedProxyHops } from './proxy-guard';

loadEnv();

const mcpEnabled = process.env.MCP_ENABLED === 'true';
const relay = mcpEnabled ? new Relay() : undefined;
const app = createApp({
  relay,
  proxy: { clientIp: nodeClientIp(parseTrustedProxyHops(process.env.TRUST_PROXY_HOPS)) },
});
app.use('/assets/*', serveStatic({ root: './dist/assets' }));
app.use('*', serveStatic({ root: './dist' }));

const port = Number(process.env.PORT) || 8787;
serve({ fetch: app.fetch, port }, (info) => {
  console.log(`sift server listening on http://localhost:${info.port}`);
  console.log(mcpEnabled ? 'MCP server enabled — http://localhost:8787/mcp' : 'MCP server disabled — set MCP_ENABLED=true in .env to enable');
});