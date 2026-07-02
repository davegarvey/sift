import { defineConfig, type ViteDevServer } from 'vite';
import type { IncomingMessage, ServerResponse } from 'node:http';
import solid from 'vite-plugin-solid';
import { VitePWA } from 'vite-plugin-pwa';
import { createApp } from './server/handle.ts';
import { Relay } from './server/relay.ts';
import { loadEnv } from './server/env.ts';

loadEnv();

// In dev, Vite serves the Solid app and we mount the Hono proxy routes as
// connect-style middleware so the browser talks to one server.
function honoDevMiddleware() {
  return {
    name: 'hono-proxy-dev',
    configureServer(server: ViteDevServer) {
      const mcpEnabled = process.env.MCP_ENABLED === 'true';
      const relay = mcpEnabled ? new Relay() : undefined;
      const devApp = createApp(relay);
      console.log(mcpEnabled ? 'MCP server enabled — http://localhost:8787/mcp' : 'MCP server disabled — set MCP_ENABLED=true in .env to enable');
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
            url.startsWith('/mcp')
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
                  headers: req.headers as unknown as Headers,
                  body: bodyInit,
                });
              const response = await devApp.fetch(request);
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
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,woff2}'],
        navigateFallback: '/index.html',
      },
      includeAssets: ['icon.svg'],
    }),
  ],
  build: {
    target: 'esnext',
    outDir: 'dist',
    assetsDir: 'assets',
  },
  server: {
    port: 8787,
  },
});