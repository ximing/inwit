import {
  scanAndEnqueueWeeklyReports,
  weeklyScanEnabled,
  WEEKLY_SCAN_MS,
} from './agent/weekly-enqueue.js';
import { config } from './config.js';
import { pool } from './db/index.js';
import { pruneAccessTokenLogs } from './auth/access-tokens.js';
import { drainJobs, processDueJobs, recoverStuckJobs } from './jobs/queue.js';
import { ensureRetrievalStores } from './retrieval/registry.js';
import { abortStaleMultipartUploads } from './storage/multipart-sweep.js';
import { logger } from './utils/logger.js';

let stopping = false;
const inFlight = new Set<Promise<void>>();
const running = new Set<() => Promise<void>>();
const ACCESS_TOKEN_LOG_PRUNE_MS = 60 * 60 * 1000;
const MULTIPART_SWEEP_MS = 60 * 60 * 1000;
let lastAccessTokenLogPrune = 0;
let lastMultipartSweep = 0;

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
  const now = Date.now();
  if (now - lastAccessTokenLogPrune >= ACCESS_TOKEN_LOG_PRUNE_MS) {
    lastAccessTokenLogPrune = now;
    try {
      await pruneAccessTokenLogs();
    } catch (err) {
      logger.error('worker.access_token_logs.prune_failed', err);
    }
  }
  if (now - lastMultipartSweep >= MULTIPART_SWEEP_MS) {
    lastMultipartSweep = now;
    try {
      const aborted = await abortStaleMultipartUploads();
      if (aborted > 0) logger.info('worker.multipart.sweep', { aborted });
    } catch (err) {
      logger.error('worker.multipart.sweep_failed', err);
    }
  }
}

async function scanWeekly(): Promise<void> {
  if (stopping) return;
  try {
    const created = await scanAndEnqueueWeeklyReports();
    if (created > 0) logger.info('worker.weekly.enqueued', { created });
  } catch (err) {
    logger.error('worker.weekly.scan_failed', err);
  }
}

await ensureRetrievalStores();

const poll = setInterval(() => {
  track(tick);
}, config.WORKER_POLL_MS);

const scanOn = weeklyScanEnabled();
const weeklyScan = scanOn
  ? setInterval(() => {
      track(scanWeekly);
    }, WEEKLY_SCAN_MS)
  : null;

logger.info('worker started', {
  pollMs: config.WORKER_POLL_MS,
  claimLimit: config.WORKER_CLAIM_LIMIT,
  maxAttempts: config.JOB_MAX_ATTEMPTS,
  weeklyScanMs: scanOn ? WEEKLY_SCAN_MS : 0,
});
track(tick);
if (scanOn) track(scanWeekly);

function shutdown(sig: string): void {
  if (stopping) return;
  stopping = true;
  logger.info(`worker received ${sig}, shutting down`);
  clearInterval(poll);
  if (weeklyScan) clearInterval(weeklyScan);
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
