import { createApp } from './handle.ts';
import { serveStatic } from '@hono/node-server/serve-static';
import { loadEnv } from './env';
import { parseTrustedProxyHops, trustedProxyClientIp } from './proxy-guard';
import { getConnInfo } from 'hono/bun';
import { createSelfHostedDatabases } from './sqlite-d1';
import { openBunSqlite } from './bun-sqlite';
import { startSelfHostedJobs } from './self-hosted-jobs';

loadEnv();

const dataDirectory = process.env.SIFT_DATA_DIR?.trim();
const databases = dataDirectory ? await createSelfHostedDatabases(dataDirectory, openBunSqlite) : undefined;
if (databases) {
  startSelfHostedJobs(databases, {
    feedPolling: process.env.FEED_POLLING === 'true',
    feedPollBatch: process.env.FEED_POLL_BATCH,
    pollDbMaxBytes: process.env.POLL_DB_MAX_BYTES,
  });
}

const app = createApp({
  db: databases?.sync as unknown as D1Database | undefined,
  pollDb: process.env.FEED_POLLING === 'true' ? databases?.poll as unknown as D1Database | undefined : undefined,
  publicUrl: process.env.PUBLIC_URL?.trim() || undefined,
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
for (const page of ['about', 'privacy', 'terms']) {
  app.get(`/${page}`, serveStatic({ path: `./dist/${page}.html` }));
}
app.get('/connect', serveStatic({ path: './dist/connect.html' }));
app.use('/assets/*', serveStatic({ root: './dist/assets' }));
app.use('*', serveStatic({ root: './dist' }));

const port = Number(process.env.PORT) || 8787;
export default {
  port,
  fetch: app.fetch,
};
