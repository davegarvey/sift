import { DEFAULT_MAX_POLL_DB_BYTES, parsePollBatch, parsePositiveInt, pollFeeds } from './feed-poller';
import { runSyncCron } from './sync/cron';
import type { SelfHostedDatabases } from './sqlite-d1';

const JOB_INTERVAL_MS = 10 * 60 * 1000;
const DAILY_CLEANUP_HOUR_UTC = 3;

function utcDay(date: Date): string {
  return `${date.getUTCFullYear()}-${date.getUTCMonth()}-${date.getUTCDate()}`;
}

export function startSelfHostedJobs(
  databases: SelfHostedDatabases,
  options: { feedPolling: boolean; feedPollBatch?: string; pollDbMaxBytes?: string },
): () => void {
  let running = false;
  let lastDailyRun = '';
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      const now = new Date();
      const day = utcDay(now);
      if (now.getUTCHours() >= DAILY_CLEANUP_HOUR_UTC && day !== lastDailyRun) {
        await runSyncCron(databases.sync as unknown as D1Database, now.getTime());
        lastDailyRun = day;
      }
      if (options.feedPolling) {
        await pollFeeds(databases.sync as unknown as D1Database, databases.poll as unknown as D1Database, {
          batch: parsePollBatch(options.feedPollBatch),
          maxDbBytes: parsePositiveInt(options.pollDbMaxBytes, DEFAULT_MAX_POLL_DB_BYTES),
        });
      }
    } catch (error) {
      console.error('Self-hosted scheduled job failed', error);
    } finally {
      running = false;
    }
  };
  const timer = setInterval(() => void tick(), JOB_INTERVAL_MS);
  void tick();
  return () => {
    clearInterval(timer);
    databases.sync.connection.close?.();
    databases.poll.connection.close?.();
  };
}
