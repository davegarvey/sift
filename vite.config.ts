import { defineConfig, type ViteDevServer } from 'vite';
import type { IncomingMessage, ServerResponse } from 'node:http';
import solid from 'vite-plugin-solid';
import { VitePWA } from 'vite-plugin-pwa';
import { createApp } from './server/handle.ts';

// In dev, Vite serves the Solid app and we mount the Hono proxy routes as
// connect-style middleware so the browser talks to one server.
function honoDevMiddleware() {
  return {
    name: 'hono-proxy-dev',
    configureServer(server: ViteDevServer) {
      const devApp = createApp();
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
            url.startsWith('/img')
          ) {
            try {
              const host = req.headers.host ?? 'localhost';
              const request = new Request(`http://${host}${url}`, {
                method: req.method ?? 'GET',
                headers: req.headers as unknown as Headers,
              });
              const response = await devApp.fetch(request);
              const headers: Record<string, string> = {};
              response.headers.forEach((value, key) => {
                headers[key] = value;
              });
              res.writeHead(response.status, headers);
              if (response.body) {
                const reader = (response.body as ReadableStream<Uint8Array>).getReader();
                while (true) {
                  const { done, value } = await reader.read();
                  if (done) break;
                  res.write(value);
                }
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