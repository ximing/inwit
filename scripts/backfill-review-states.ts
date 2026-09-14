import { pool } from '../apps/server/src/db/index.js';
import { backfillMissingReviewStates } from '../apps/server/src/review/state-init.js';

try {
  const n = await backfillMissingReviewStates();
  console.log(`backfilled ${String(n)} review_state(s)`);
} catch (err) {
  console.error('backfill failed', err);
  process.exitCode = 1;
} finally {
  await pool.end();
}
