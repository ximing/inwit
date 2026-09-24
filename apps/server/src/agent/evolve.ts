import { evolveAnalyzeJobPayloadFrom, evolveJobPayloadFrom, type EvolveReason } from '@inwit/dto';
import { and, eq, inArray, isNull } from 'drizzle-orm';
import { getDb } from '../db/index.js';
import { cardQuestions, cards, reviewStates, type CardRow, type JobRow } from '../db/schema.js';
import { logger } from '../utils/logger.js';
import { processAnalyzePatterns } from './analyze.js';
import { addedQuestionIsNewAngle, evolveResultSummary } from './evolve-logic.js';
import { evolveTools, loadSplitChildren, type EvolveSession } from './evolve-tools.js';
import { EVOLVE_SYSTEM_PROMPT, evolveUserPrompt } from './prompts.js';
import { AgentTerminalError, runAgentJob } from './run-agent-job.js';

async function loadOwnedCard(userId: string, cardId: string): Promise<CardRow | null> {
  const [row] = await getDb()
    .select()
    .from(cards)
    .where(and(eq(cards.id, cardId), eq(cards.userId, userId), isNull(cards.deletedAt)))
    .limit(1);
  return row ?? null;
}

async function loadQuestions(cardIds: string[]) {
  if (cardIds.length === 0) return [];
  return getDb()
    .select()
    .from(cardQuestions)
    .where(inArray(cardQuestions.cardId, cardIds));
}

async function countAddedQuestions(
  cardIds: string[],
  preexistingIds: Set<string>,
): Promise<{ added: number; addedTypes: string[]; allTypes: string[] }> {
  const questions = await loadQuestions(cardIds);
  const added = questions.filter((row) => !preexistingIds.has(row.id));
  return {
    added: added.length,
    addedTypes: added.map((row) => row.type),
    allTypes: questions.map((row) => row.type),
  };
}

async function childrenHaveQuestionsAndDue(userId: string, childIds: string[]): Promise<boolean> {
  if (childIds.length === 0) return false;
  const questionRows = await loadQuestions(childIds);
  const withQuestion = new Set(questionRows.map((row) => row.cardId));
  if (childIds.some((id) => !withQuestion.has(id))) return false;
  const states = await getDb()
    .select()
    .from(reviewStates)
    .where(and(eq(reviewStates.userId, userId), inArray(reviewStates.cardId, childIds)));
  const now = Date.now();
  const dueByCard = new Map(states.map((row) => [row.cardId, row.dueAt]));
  return childIds.every((id) => {
    const due = dueByCard.get(id);
    return due !== undefined && due.getTime() > now;
  });
}

export async function processEvolve(job: JobRow): Promise<void> {
  if (evolveAnalyzeJobPayloadFrom(job.payload)) {
    await processAnalyzePatterns(job);
    return;
  }
  const payload = evolveJobPayloadFrom(job.payload);
  if (!payload) {
    throw new AgentTerminalError('evolve job missing cardId/reason');
  }
  const { cardId, reason } = payload;
  logger.info('evolve.start', { jobId: job.id, cardId, reason, userId: job.userId });

  const card = await loadOwnedCard(job.userId, cardId);
  if (!card) {
    logger.warn('evolve.card_missing', { jobId: job.id, cardId });
    throw new AgentTerminalError('card not found');
  }

  const preexistingQuestions = await loadQuestions([cardId]);
  const preexistingIds = new Set(preexistingQuestions.map((row) => row.id));
  const preexistingTypes = preexistingQuestions.map((row) => row.type);

  const session: EvolveSession = {
    userId: job.userId,
    cardId,
    reason,
    documentId: card.documentId,
    writtenCardIds: [],
    writtenQuestionIds: [],
    splitChildIds: [],
    memoryWritten: false,
  };

  await runAgentJob({
    job,
    agentType: 'evolve',
    systemPrompt: EVOLVE_SYSTEM_PROMPT,
    userPrompt: evolveUserPrompt({ cardId, reason }),
    tools: evolveTools(session),
    maxTurns: 32,
    context: card.documentId ? { documentId: card.documentId } : undefined,
    verify: async () => {
      await assertEvolveOutcome({
        userId: job.userId,
        cardId,
        reason,
        preexistingIds,
        preexistingTypes,
        session,
      });

      const parentStillThere = await loadOwnedCard(job.userId, cardId);
      if (!parentStillThere) throw new Error('evolve deleted the original card');

      const questionDelta = session.writtenQuestionIds.length;
      const childCount = (await loadSplitChildren(job.userId, cardId)).length;
      return evolveResultSummary({
        reason,
        questionDelta,
        childCount,
        memoryWritten: session.memoryWritten,
      });
    },
  });
}

async function assertEvolveOutcome(input: {
  userId: string;
  cardId: string;
  reason: EvolveReason;
  preexistingIds: Set<string>;
  preexistingTypes: string[];
  session: EvolveSession;
}): Promise<void> {
  if (!input.session.memoryWritten) {
    throw new Error('evolve did not call write_memory');
  }

  if (input.reason === 'fuzzy') {
    const stats = await countAddedQuestions([input.cardId], input.preexistingIds);
    if (!addedQuestionIsNewAngle(input.preexistingTypes, stats.addedTypes)) {
      throw new Error('evolve fuzzy did not add a question with a different type');
    }
    return;
  }

  const children = await loadSplitChildren(input.userId, input.cardId);
  if (children.length < 1 || children.length > 2) {
    throw new Error(`evolve split expected 1-2 child cards, got ${String(children.length)}`);
  }
  const childIds = children.map((child) => child.id);
  const parent = await loadOwnedCard(input.userId, input.cardId);
  if (!parent) throw new Error('original card missing after split');
  for (const child of children) {
    if (child.documentId !== parent.documentId) {
      throw new Error('split child document_id mismatch');
    }
    if (child.source !== 'agent') {
      throw new Error('split child source must be agent');
    }
  }
  const ok = await childrenHaveQuestionsAndDue(input.userId, childIds);
  if (!ok) {
    throw new Error('split children must each have a question and a future due date');
  }
}
