import { createApp, type AppEnv } from './handle.ts';

interface WorkerBindings {
  ASSETS: { fetch: (request: Request) => Response };
}

type WorkerEnv = AppEnv & { Bindings: WorkerBindings };

const app = createApp<WorkerEnv>();

// Fallback to static assets for any unmatched route (app shell, /assets/*).
app.all('*', (c) => {
  const assets = c.env.ASSETS;
  if (assets && typeof assets.fetch === 'function') {
    return assets.fetch(c.req.raw);
  }
  return c.body('Not Found', { status: 404 });
});

export default {
  async fetch(request: Request, env: WorkerBindings): Promise<Response> {
    return app.fetch(request, env);
  },
};