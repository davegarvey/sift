/**
 * Minimal Worker entry point for integration tests.
 *
 * Bundles only the sync routes — no frontend code, no asset handling.
 * Used by sync-d1.test.ts against Miniflare + real SQLite D1.
 */
import { createSyncRoutes } from './routes';

interface Env {
  DB: D1Database;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const app = createSyncRoutes(env.DB);
    return app.fetch(request, env);
  },
};
