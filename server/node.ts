import { createApp } from './handle.ts';
import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { Relay } from './relay';
import { loadEnv } from './env';
import { nodeClientIp } from './node-client-ip';
import { parseTrustedProxyHops } from './proxy-guard';
import { createSelfHostedDatabases } from './sqlite-d1';
import { openNodeSqlite } from './node-sqlite';
import { startSelfHostedJobs } from './self-hosted-jobs';

loadEnv();

const dataDirectory = process.env.SIFT_DATA_DIR?.trim();
const databases = dataDirectory ? await createSelfHostedDatabases(dataDirectory, openNodeSqlite) : undefined;
if (databases) {
  startSelfHostedJobs(databases, {
    feedPolling: process.env.FEED_POLLING === 'true',
    feedPollBatch: process.env.FEED_POLL_BATCH,
    pollDbMaxBytes: process.env.POLL_DB_MAX_BYTES,
  });
}

const mcpEnabled = process.env.MCP_ENABLED === 'true';
const relay = mcpEnabled ? new Relay() : undefined;
const app = createApp({
  relay,
  db: databases?.sync as unknown as D1Database | undefined,
  pollDb: process.env.FEED_POLLING === 'true' ? databases?.poll as unknown as D1Database | undefined : undefined,
  proxy: { clientIp: nodeClientIp(parseTrustedProxyHops(process.env.TRUST_PROXY_HOPS)) },
});
for (const page of ['about', 'privacy', 'terms']) {
  app.get(`/${page}`, serveStatic({ path: `./dist/${page}.html` }));
}
app.use('/assets/*', serveStatic({ root: './dist/assets' }));
app.use('*', serveStatic({ root: './dist' }));

const port = Number(process.env.PORT) || 8787;
serve({ fetch: app.fetch, port }, (info) => {
  console.log(`sift server listening on http://localhost:${info.port}`);
  console.log(mcpEnabled ? 'MCP server enabled — http://localhost:8787/mcp' : 'MCP server disabled — set MCP_ENABLED=true in .env to enable');
});
