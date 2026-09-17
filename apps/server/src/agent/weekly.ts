import { weeklyReportJobPayloadFrom } from '@inwit/dto';
import { and, eq } from 'drizzle-orm';
import { getDb } from '../db/index.js';
import { documents, type JobRow } from '../db/schema.js';
import { documentPlainText } from '../documents/content-json.js';
import { loadUserMasteryMemory } from '../review/mastery-memory.js';
import { logger } from '../utils/logger.js';
import { WEEKLY_SYSTEM_PROMPT, weeklyUserPrompt } from './prompts.js';
import { runAgentJob } from './run-agent-job.js';
import {
  parseWeeklyReportMemory,
  startOfWeekMonday,
  weeklyReportMemoryKey,
  weeklyResultSummary,
} from './weekly-logic.js';
import { createWeeklySession, loadWeekStats, weeklyTools, type WeeklySession } from './weekly-tools.js';

const MAX_TURNS = 16;

function sessionFromJob(job: JobRow): WeeklySession {
  const payload = weeklyReportJobPayloadFrom(job.payload);
  const now = new Date();
  if (!payload) return createWeeklySession(job.userId, now);
  const [y, m, d] = payload.weekStart.split('-').map((part) => Number(part));
  if (!y || !m || !d) return createWeeklySession(job.userId, now);
  const pinned = new Date(y, m - 1, d, 12, 0, 0);
  return createWeeklySession(job.userId, startOfWeekMonday(pinned));
}

export async function processWeeklyReport(job: JobRow): Promise<void> {
  const session = sessionFromJob(job);
  logger.info('weekly.start', {
    jobId: job.id,
    userId: job.userId,
    weekStart: session.weekStart,
  });

  const stats = await loadWeekStats(session);

  await runAgentJob({
    job,
    agentType: 'weekly_report',
    systemPrompt: WEEKLY_SYSTEM_PROMPT,
    userPrompt: weeklyUserPrompt({ weekStart: session.weekStart, weekEnd: session.weekEnd }),
    tools: weeklyTools(session),
    maxTurns: MAX_TURNS,
    verify: async () => {
      await assertWeeklyOutcome(job.userId, session);
      return weeklyResultSummary({
        document: session.wroteDocument,
        memory: session.memoryWritten,
        relearn: stats.relearn.length,
        reviews: stats.reviews.total,
      });
    },
  });
}

async function assertWeeklyOutcome(userId: string, session: WeeklySession): Promise<void> {
  if (!session.wroteDocument || !session.documentId) {
    throw new Error('weekly report did not write a document');
  }
  const [doc] = await getDb()
    .select({ id: documents.id, source: documents.source, title: documents.title, contentJson: documents.contentJson })
    .from(documents)
    .where(and(eq(documents.id, session.documentId), eq(documents.userId, userId)))
    .limit(1);
  if (!doc) throw new Error('weekly report document missing');
  if (doc.source !== 'agent') throw new Error('weekly report document source must be agent');
  if (!doc.title?.includes('学习复盘')) throw new Error('weekly report title must include 学习复盘');
  const contentText = documentPlainText(doc.contentJson);
  if (!/想起来了/.test(contentText) || !/模糊/.test(contentText) || !/忘了/.test(contentText)) {
    throw new Error('weekly report document missing 三档分布');
  }
  const stats = session.stats;
  if (stats && stats.relearn.length > 0) {
    const missing = stats.relearn.filter((item) => !contentText.includes(`/cards/${item.cardId}`));
    if (missing.length > 0) {
      throw new Error('weekly report document missing card links for relearn concepts');
    }
  }
  const memory = await loadUserMasteryMemory(
    getDb(),
    userId,
    weeklyReportMemoryKey(session.weekStart),
  );
  const parsed = parseWeeklyReportMemory(memory?.content);
  if (!parsed.documentId) throw new Error('weekly report did not write memory');
}
