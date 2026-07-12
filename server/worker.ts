import { createApp, type AppEnv } from './handle.ts';
import { runSyncCron } from './sync/cron.ts';

interface WorkerBindings {
  ASSETS: { fetch: (request: Request) => Response };
  DB?: D1Database;
}

type WorkerEnv = AppEnv & { Bindings: WorkerBindings };

function buildApp(db: D1Database | undefined) {
  const app = createApp<WorkerEnv>({ db });
  app.all('*', (c) => {
    const assets = c.env.ASSETS;
    if (assets && typeof assets.fetch === 'function') {
      return assets.fetch(c.req.raw);
    }
    return c.body('Not Found', { status: 404 });
  });
  return app;
}

export default {
  async fetch(request: Request, env: WorkerBindings): Promise<Response> {
    const app = buildApp(env.DB);
    return app.fetch(request, env);
  },
  async scheduled(_event: ScheduledController, env: WorkerBindings): Promise<void> {
    if (env.DB) {
      await runSyncCron(env.DB, _event.scheduledTime);
    }
  },
};
