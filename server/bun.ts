import { createApp } from './handle.ts';
// @ts-expect-error — bun's serve-static exists at runtime; types ship in
// the bun runtime which isn't installed in this dev environment.
import { serveStatic } from 'hono/bun/serve-static';
import { Relay } from './relay';
import { loadEnv } from './env';
import { parseTrustedProxyHops, trustedProxyClientIp } from './proxy-guard';
import { getConnInfo } from 'hono/bun';

loadEnv();

const mcpEnabled = process.env.MCP_ENABLED === 'true';
const relay = mcpEnabled ? new Relay() : undefined;
const app = createApp({
  relay,
  proxy: {
    clientIp: trustedProxyClientIp((c) => {
      try {
        return getConnInfo(c).remote.address;
      } catch {
        return undefined;
      }
    }, parseTrustedProxyHops(process.env.TRUST_PROXY_HOPS)),
  },
});
app.use('/assets/*', serveStatic({ root: './dist/assets' }));
app.use('*', serveStatic({ root: './dist' }));

console.log(mcpEnabled ? 'MCP server enabled — http://localhost:8787/mcp' : 'MCP server disabled — set MCP_ENABLED=true in .env to enable');

const port = Number(process.env.PORT) || 8787;
export default {
  port,
  fetch: app.fetch,
};