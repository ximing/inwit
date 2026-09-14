import { config } from './config.js';
import { pool } from './db/index.js';
import { drainJobs, processDueJobs, recoverStuckJobs } from './jobs/queue.js';
import { ensureRetrievalStores } from './retrieval/registry.js';
import { logger } from './utils/logger.js';

let stopping = false;
const inFlight = new Set<Promise<void>>();
const running = new Set<() => Promise<void>>();

function track(fn: () => Promise<void>): void {
  if (stopping || running.has(fn)) return;
  running.add(fn);
  const task = fn();
  inFlight.add(task);
  void task.finally(() => {
    inFlight.delete(task);
    running.delete(fn);
  });
}

async function tick(): Promise<void> {
  if (stopping) return;
  try {
    const recovered = await recoverStuckJobs();
    if (recovered > 0) logger.info('worker.recover', { recovered });
  } catch (err) {
    logger.error('worker.recover.failed', err);
  }
  try {
    const claimed = await processDueJobs();
    if (claimed > 0) logger.info('worker.tick', { claimed });
  } catch (err) {
    logger.error('worker.tick.failed', err);
  }
}

await ensureRetrievalStores();

const poll = setInterval(() => {
  track(tick);
}, config.WORKER_POLL_MS);

logger.info('worker started', {
  pollMs: config.WORKER_POLL_MS,
  claimLimit: config.WORKER_CLAIM_LIMIT,
  maxAttempts: config.JOB_MAX_ATTEMPTS,
});
track(tick);

function shutdown(sig: string): void {
  if (stopping) return;
  stopping = true;
  logger.info(`worker received ${sig}, shutting down`);
  clearInterval(poll);
  void (async () => {
    await drainJobs();
    await Promise.allSettled([...inFlight]);
    await pool.end();
  })().then(
    () => process.exit(0),
    (err: unknown) => {
      logger.error('worker shutdown failed', err);
      process.exit(1);
    },
  );
}

for (const sig of ['SIGINT', 'SIGTERM'] as const) {
  process.on(sig, () => {
    shutdown(sig);
  });
}
