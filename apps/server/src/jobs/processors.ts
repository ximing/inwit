import type { JobType } from '@inwit/dto';
import { processChat } from '../agent/chat.js';
import { processDigest } from '../agent/digest.js';
import { processEvolve } from '../agent/evolve.js';
import { AgentTerminalError } from '../agent/run-agent-job.js';
import { processSelection } from '../agent/selection.js';
import { processTopic } from '../agent/topic.js';
import { processWeeklyReport } from '../agent/weekly.js';
import { processAnnotationResurface } from '../annotations/resurface.js';
import type { JobRow } from '../db/schema.js';
import { processExtract } from '../documents/extract-job.js';
import { processOcr } from '../ocr/ocr-job.js';
import { logger } from '../utils/logger.js';

const HANDLERS: Record<JobType, (job: JobRow) => Promise<void>> = {
  digest: processDigest,
  chat: processChat,
  evolve: processEvolve,
  topic: processTopic,
  weekly_report: processWeeklyReport,
  selection: processSelection,
  extract: processExtract,
  ocr: processOcr,
  annotation_resurface: processAnnotationResurface,
};

export async function processJob(job: JobRow): Promise<void> {
  try {
    await HANDLERS[job.type](job);
  } catch (err) {
    if (err instanceof AgentTerminalError) {
      // Terminal failures still settle as failed jobs (no retry) — the queue
      // records lastError and reflects the failure onto the owned document.
      logger.warn(`${job.type}.terminal`, { jobId: job.id, error: err.message });
    }
    throw err;
  }
}
