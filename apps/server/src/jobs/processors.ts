import { ChatTerminalError, processChat } from '../agent/chat.js';
import { DigestTerminalError, processDigest } from '../agent/digest.js';
import { TopicTerminalError, processTopic } from '../agent/topic.js';
import type { JobRow } from '../db/schema.js';
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
      await processEvolveStub(job);
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
      logger.info('job.stub', { jobId: job.id, type: job.type });
      return;
    default: {
      const exhaustive: never = job.type;
      throw new Error(`unknown job type: ${String(exhaustive)}`);
    }
  }
}

async function processEvolveStub(job: JobRow): Promise<void> {
  const cardId = typeof job.payload.cardId === 'string' ? job.payload.cardId : undefined;
  const reason = typeof job.payload.reason === 'string' ? job.payload.reason : undefined;
  logger.info('evolve.stub', { jobId: job.id, cardId, reason, userId: job.userId });
}
