import { createApp, type AppEnv } from './handle.ts';
import { runSyncCron } from './sync/cron.ts';
import { DEFAULT_MAX_POLL_DB_BYTES, parsePollBatch, parsePositiveInt, pollFeeds } from './feed-poller.ts';

const DAILY_CLEANUP_CRON = '0 3 * * *';

interface WorkerBindings {
  ASSETS: { fetch: (request: Request) => Response };
  DB?: D1Database;
  POLL_DB?: D1Database;
  FEED_POLLING?: string;
  FEED_POLL_BATCH?: string;
  POLL_DB_MAX_BYTES?: string;
}

type WorkerEnv = AppEnv & { Bindings: WorkerBindings };

function pollDatabase(env: WorkerBindings): D1Database | undefined {
  return env.FEED_POLLING === 'true' ? env.POLL_DB : undefined;
}

function buildApp(env: WorkerBindings) {
  const app = createApp<WorkerEnv>({ db: env.DB, pollDb: pollDatabase(env) });
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
    const app = buildApp(env);
    return app.fetch(request, env);
  },
  async scheduled(event: ScheduledController, env: WorkerBindings): Promise<void> {
    if (!env.DB) return;
    if (event.cron === DAILY_CLEANUP_CRON) {
      await runSyncCron(env.DB, event.scheduledTime);
      return;
    }
    const pollDb = pollDatabase(env);
    if (pollDb) {
      await pollFeeds(env.DB, pollDb, {
        batch: parsePollBatch(env.FEED_POLL_BATCH),
        maxDbBytes: parsePositiveInt(env.POLL_DB_MAX_BYTES, DEFAULT_MAX_POLL_DB_BYTES),
      });
    }
  },
};
