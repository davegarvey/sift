import { defineConfig, type ViteDevServer } from 'vite';
import type { IncomingMessage, ServerResponse } from 'node:http';
import solid from 'vite-plugin-solid';
import { VitePWA } from 'vite-plugin-pwa';
import { createApp } from './server/handle.ts';
import { loadEnv } from './server/env.ts';
import { nodeClientIp } from './server/node-client-ip.ts';
import { parseTrustedProxyHops } from './server/proxy-guard.ts';
import { createSelfHostedDatabases } from './server/sqlite-d1.ts';
import { openNodeSqlite } from './server/node-sqlite.ts';
import { startSelfHostedJobs } from './server/self-hosted-jobs.ts';

loadEnv();

// In dev, Vite serves the Solid app and we mount the Hono proxy routes as
// connect-style middleware so the browser talks to one server.
function honoDevMiddleware() {
  return {
    name: 'hono-proxy-dev',
    async configureServer(server: ViteDevServer) {
      const databases = await createSelfHostedDatabases(process.env.SIFT_DATA_DIR || 'node_modules/.cache/sift', openNodeSqlite);
      const stopJobs = startSelfHostedJobs(databases, {
        feedPolling: process.env.FEED_POLLING === 'true',
        feedPollBatch: process.env.FEED_POLL_BATCH,
        pollDbMaxBytes: process.env.POLL_DB_MAX_BYTES,
      });
      server.httpServer?.once('close', stopJobs);
      const devApp = createApp({
        db: databases.sync as unknown as D1Database,
        pollDb: process.env.FEED_POLLING === 'true' ? databases.poll as unknown as D1Database : undefined,
        publicUrl: process.env.PUBLIC_URL?.trim() || undefined,
        proxy: { clientIp: nodeClientIp(parseTrustedProxyHops(process.env.TRUST_PROXY_HOPS)) },
      });
      server.middlewares.use(
        async (
          req: IncomingMessage,
          res: ServerResponse,
          next: (err?: unknown) => void,
        ) => {
          const url = req.url ?? '';
          if (
            url.startsWith('/feed') ||
            url.startsWith('/article') ||
            url.startsWith('/img') ||
            url.startsWith('/api') ||
            url.startsWith('/sync')
          ) {
              try {
                const host = req.headers.host ?? 'localhost';
                let bodyInit: BodyInit | undefined;
                const method = req.method ?? 'GET';
                if (method !== 'GET' && method !== 'HEAD') {
                  bodyInit = await new Promise<string>((resolve, reject) => {
                    const chunks: Buffer[] = [];
                    req.on('data', (chunk: Buffer) => chunks.push(chunk));
                    req.on('end', () => resolve(Buffer.concat(chunks).toString()));
                    req.on('error', reject);
                  });
                }
                const request = new Request(`http://${host}${url}`, {
                  method,
                  headers: req.headers as unknown as Headers, // why: IncomingMessage.headers is IncomingHttpHeaders, not HeadersInit
                  body: bodyInit,
                });
              const response = await devApp.fetch(request, { incoming: req });
              const headers: Record<string, string> = {};
              response.headers.forEach((value, key) => {
                headers[key] = value;
              });
              res.writeHead(response.status, headers);
              if (response.body) {
                const { Readable } = await import('stream');
                const nodeStream = Readable.fromWeb(response.body as ReadableStream<Uint8Array>);
                nodeStream.pipe(res);
                return;
              }
              res.end();
            } catch (err) {
              next(err as Error);
            }
            return;
          }
          if (/^\/(about|privacy|terms)(\?.*)?$/.test(url)) {
            req.url = url.replace(/^(\/about|\/privacy|\/terms)/, '$1.html');
          }
          next();
        },
      );
    },
  };
}

export default defineConfig({
  plugins: [
    honoDevMiddleware(),
    solid(),
    VitePWA({
      registerType: 'autoUpdate',
      manifest: {
        name: 'Sift',
        short_name: 'Sift',
        display: 'standalone',
        background_color: '#ffffff',
        theme_color: '#1e1e2e',
        icons: [
          {
            src: '/icon.svg',
            sizes: 'any',
            type: 'image/svg+xml',
            purpose: 'any',
          },
          {
            src: '/icon-192.png',
            sizes: '192x192',
            type: 'image/png',
            purpose: 'any',
          },
          {
            src: '/icon-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'any',
          },
          {
            src: '/icon-maskable-192.png',
            sizes: '192x192',
            type: 'image/png',
            purpose: 'maskable',
          },
          {
            src: '/icon-maskable-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,woff2}'],
        navigateFallback: '/index.html',
        navigateFallbackDenylist: [/^\/(?:about|privacy|terms)(?:\.html)?\/?$/],
      },
      includeAssets: ['icon.svg', 'icon-192.png', 'icon-512.png', 'icon-maskable-192.png', 'icon-maskable-512.png'],
    }),
  ],
  build: {
    target: 'esnext',
    outDir: 'dist',
    assetsDir: 'assets',
    sourcemap: 'hidden',
  },
  server: {
    port: 8787,
  },
});
