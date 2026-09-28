/**
 * Minimal Worker entry point for integration tests.
 *
 * Bundles only the sync routes — no frontend code, no asset handling.
 * Used by sync-d1.test.ts against Miniflare + real SQLite D1.
 */
import { createSyncRoutes } from './routes';

interface Env {
  DB: D1Database;
  POLL_DB?: D1Database;
  FEED_POLLING?: string;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const pollDb = env.FEED_POLLING === 'true' ? env.POLL_DB : undefined;
    const app = createSyncRoutes(env.DB, { pollDb });
    return app.fetch(request, env);
  },
};
