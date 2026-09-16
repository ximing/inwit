import { ChatTerminalError, processChat } from '../agent/chat.js';
import { DigestTerminalError, processDigest } from '../agent/digest.js';
import { EvolveTerminalError, processEvolve } from '../agent/evolve.js';
import { SelectionTerminalError, processSelection } from '../agent/selection.js';
import { TopicTerminalError, processTopic } from '../agent/topic.js';
import { WeeklyTerminalError, processWeeklyReport } from '../agent/weekly.js';
import type { JobRow } from '../db/schema.js';
import { processExtract } from '../documents/extract-job.js';
import { processOcr } from '../ocr/ocr-job.js';
import { logger } from '../utils/logger.js';

export async function processJob(job: JobRow): Promise<void> {
  switch (job.type) {
    case 'digest':
      try {
        await processDigest(job);
      } catch (err) {
        if (err instanceof DigestTerminalError) {
          logger.warn('digest.terminal', { jobId: job.id, error: err.message });
          return;
        }
        throw err;
      }
      return;
    case 'chat':
      try {
        await processChat(job);
      } catch (err) {
        if (err instanceof ChatTerminalError) {
          logger.warn('chat.terminal', { jobId: job.id, error: err.message });
          return;
        }
        throw err;
      }
      return;
    case 'evolve':
      try {
        await processEvolve(job);
      } catch (err) {
        if (err instanceof EvolveTerminalError) {
          logger.warn('evolve.terminal', { jobId: job.id, error: err.message });
          return;
        }
        throw err;
      }
      return;
    case 'topic':
      try {
        await processTopic(job);
      } catch (err) {
        if (err instanceof TopicTerminalError) {
          logger.warn('topic.terminal', { jobId: job.id, error: err.message });
          return;
        }
        throw err;
      }
      return;
    case 'weekly_report':
      try {
        await processWeeklyReport(job);
      } catch (err) {
        if (err instanceof WeeklyTerminalError) {
          logger.warn('weekly.terminal', { jobId: job.id, error: err.message });
          return;
        }
        throw err;
      }
      return;
    case 'selection':
      try {
        await processSelection(job);
      } catch (err) {
        if (err instanceof SelectionTerminalError) {
          logger.warn('selection.terminal', { jobId: job.id, error: err.message });
          return;
        }
        throw err;
      }
      return;
    case 'extract':
      await processExtract(job);
      return;
    case 'ocr':
      await processOcr(job);
      return;
    default: {
      const exhaustive: never = job.type;
      throw new Error(`unknown job type: ${String(exhaustive)}`);
    }
  }
}


