import { createApp } from './handle.ts';
// @ts-expect-error — bun's serve-static exists at runtime; types ship in
// the bun runtime which isn't installed in this dev environment.
import { serveStatic } from 'hono/bun/serve-static';

const app = createApp();
app.use('/assets/*', serveStatic({ root: './dist/assets' }));
app.use('*', serveStatic({ root: './dist' }));

const port = Number(process.env.PORT) || 8787;
export default {
  port,
  fetch: app.fetch,
};