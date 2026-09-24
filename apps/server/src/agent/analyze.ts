import { and, eq, inArray, isNull } from 'drizzle-orm';
import { getDb } from '../db/index.js';
import { cardQuestions, cards, reviewStates, type JobRow } from '../db/schema.js';
import { logger } from '../utils/logger.js';
import {
  ANALYZE_MAX_CARDS,
  ANALYZE_MIN_CARDS,
  analyzeResultSummary,
  confusableMemoryKey,
  eligibleContrastPairs,
} from './analyze-logic.js';
import {
  analyzeTools,
  createAnalyzeSession,
  loadConfusableMemories,
  loadStrugglingCards,
  type AnalyzeSession,
} from './analyze-tools.js';
import { ANALYZE_SYSTEM_PROMPT, analyzeUserPrompt } from './prompts.js';
import { runAgentJob } from './run-agent-job.js';

export async function processAnalyzePatterns(job: JobRow): Promise<void> {
  logger.info('evolve.analyze.start', { jobId: job.id, userId: job.userId });

  const struggling = await loadStrugglingCards(job.userId);
  const session = createAnalyzeSession(job.userId);

  await runAgentJob({
    job,
    agentType: 'evolve',
    systemPrompt: ANALYZE_SYSTEM_PROMPT,
    userPrompt: analyzeUserPrompt(),
    tools: analyzeTools(session),
    maxTurns: 40,
    beforeRun: () => {
      if (struggling.length < 2) {
        return analyzeResultSummary({
          skipped: 'too_few',
          struggling: struggling.length,
          pairs: 0,
          document: false,
          cards: 0,
          memory: 0,
        });
      }
    },
    verify: async () => {
      await assertAnalyzeOutcome(
        job.userId,
        session,
        struggling.map((card) => card.id),
      );
      return analyzeResultSummary({
        ...(session.skippedDocument && !session.wroteDocument ? { skipped: 'cooldown' as const } : {}),
        struggling: struggling.length,
        pairs: session.linkedPairKeys.length || session.memoryKeys.length,
        document: session.wroteDocument,
        cards: session.digest.writtenCardIds.length,
        memory: session.memoryKeys.length,
      });
    },
  });
}

async function assertAnalyzeOutcome(
  userId: string,
  session: AnalyzeSession,
  strugglingIds: string[],
): Promise<void> {
  const memories = await loadConfusableMemories(userId);
  const cooldownKeys = new Set(memories.filter((row) => row.onCooldown).map((row) => row.key));
  const eligible = eligibleContrastPairs(strugglingIds, cooldownKeys);

  if (session.wroteDocument) {
    await assertContrastCards(userId, session);
    return;
  }

  if (session.skippedDocument || eligible.length === 0) return;

  if (!session.memoryWritten) {
    throw new Error('analyze did not call write_memory');
  }
  throw new Error('analyze did not write a contrast document');
}

async function assertContrastCards(userId: string, session: AnalyzeSession): Promise<void> {
  const documentId = session.digest.documentId;
  if (!documentId) throw new Error('analyze wrote a document but session has no documentId');
  const childCards = await getDb()
    .select()
    .from(cards)
    .where(and(eq(cards.userId, userId), eq(cards.documentId, documentId), isNull(cards.deletedAt)));
  if (childCards.length < ANALYZE_MIN_CARDS || childCards.length > ANALYZE_MAX_CARDS) {
    throw new Error(
      `analyze contrast doc expected ${String(ANALYZE_MIN_CARDS)}-${String(ANALYZE_MAX_CARDS)} cards, got ${String(childCards.length)}`,
    );
  }
  const childIds = childCards.map((row) => row.id);
  const [questionRows, stateRows] = await Promise.all([
    getDb().select().from(cardQuestions).where(inArray(cardQuestions.cardId, childIds)),
    getDb()
      .select()
      .from(reviewStates)
      .where(and(eq(reviewStates.userId, userId), inArray(reviewStates.cardId, childIds))),
  ]);
  const questionsByCard = new Map<string, typeof questionRows>();
  for (const row of questionRows) {
    const list = questionsByCard.get(row.cardId) ?? [];
    list.push(row);
    questionsByCard.set(row.cardId, list);
  }
  const stateByCard = new Set(stateRows.map((row) => row.cardId));
  for (const card of childCards) {
    if (card.source !== 'agent') throw new Error('contrast card source must be agent');
    const qs = questionsByCard.get(card.id) ?? [];
    if (qs.length < 1) throw new Error('contrast cards must each have a question');
    if (qs.some((q) => q.type !== 'compare' && q.type !== 'judge')) {
      throw new Error('contrast questions must be compare or judge');
    }
    if (!stateByCard.has(card.id)) throw new Error('contrast cards must have review_states');
  }
  if (session.pairCardIds) {
    const key = confusableMemoryKey(session.pairCardIds[0], session.pairCardIds[1]);
    if (!session.memoryKeys.includes(key)) {
      throw new Error('analyze did not write confusable memory for the contrast pair');
    }
  }
}
