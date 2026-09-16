import { Type, type Static } from '@earendil-works/pi-ai';
import type { AgentTool } from '@earendil-works/pi-agent-core';
import { CARD_LINK_TYPES, type CardLinkType, type EvolveReason } from '@inwit/dto';
import { and, asc, count, desc, eq, inArray, or } from 'drizzle-orm';
import { toPublicQuestion } from '../cards/card.mapper.js';
import { getDb } from '../db/index.js';
import { isUniqueViolation } from '../db/pg.js';
import {
  cardLinks,
  cardQuestions,
  cards,
  documents,
  reviewLogs,
  reviewStates,
  type CardRow,
} from '../db/schema.js';
import { recalculateMapNodeStatus } from '../maps/map.service.js';
import { deleteCard, indexCard } from '../retrieval/pipeline.js';
import {
  loadUserMasteryMemory,
  masteryCardKey,
  parseMasteryRecent,
  upsertUserMasteryMemory,
} from '../review/mastery-memory.js';
import { insertInitialReviewState } from '../review/state-init.js';
import { logger } from '../utils/logger.js';
import { parseAnchorBlock, resolveAnchor } from './anchors.js';
import { SPLIT_LINK_REASON, SPLIT_LINK_TYPE, SPLIT_MAX_CHILDREN } from './evolve-logic.js';
import { asToolError } from './tools.js';

export interface EvolveSession {
  userId: string;
  cardId: string;
  reason: EvolveReason;
  documentId: string | null;
  writtenCardIds: string[];
  writtenQuestionIds: string[];
  splitChildIds: string[];
  memoryWritten: boolean;
}

function toolResult(text: string, details: unknown = null) {
  return { content: [{ type: 'text' as const, text }], details };
}

function allowedQuestionCardIds(session: EvolveSession): Set<string> {
  if (session.reason === 'fuzzy') return new Set([session.cardId]);
  return new Set(session.splitChildIds);
}

export const readCardSchema = Type.Object({
  cardId: Type.String({ minLength: 1, maxLength: 36 }),
});
export type ReadCardArgs = Static<typeof readCardSchema>;

export function readCardTool(session: EvolveSession): AgentTool<typeof readCardSchema> {
  return {
    name: 'read_card',
    label: '读取卡片',
    description:
      '读取当前卡片的概念、例子、易混点、已有题目、复习状态、最近 5 次反馈和 mastery memory。必须先调用。',
    parameters: readCardSchema,
    execute: async (_id, params) => {
      if (params.cardId !== session.cardId) {
        throw new Error('cardId does not match the job card');
      }
      const [card] = await getDb()
        .select()
        .from(cards)
        .where(and(eq(cards.id, session.cardId), eq(cards.userId, session.userId)))
        .limit(1);
      if (!card) throw new Error('card not found');

      const [questionRows, [state], logRows, memory] = await Promise.all([
        getDb()
          .select()
          .from(cardQuestions)
          .where(eq(cardQuestions.cardId, card.id))
          .orderBy(asc(cardQuestions.createdAt), asc(cardQuestions.id)),
        getDb()
          .select()
          .from(reviewStates)
          .where(and(eq(reviewStates.userId, session.userId), eq(reviewStates.cardId, card.id)))
          .limit(1),
        getDb()
          .select({
            feedback: reviewLogs.feedback,
            reviewedAt: reviewLogs.reviewedAt,
          })
          .from(reviewLogs)
          .where(and(eq(reviewLogs.userId, session.userId), eq(reviewLogs.cardId, card.id)))
          .orderBy(desc(reviewLogs.reviewedAt), desc(reviewLogs.id))
          .limit(5),
        loadUserMasteryMemory(getDb(), session.userId, masteryCardKey(card.id)),
      ]);

      const splitChildren = await loadSplitChildren(session.userId, card.id);
      const recent =
        parseMasteryRecent(memory?.content).length > 0
          ? parseMasteryRecent(memory?.content)
          : logRows
              .slice()
              .reverse()
              .map((row) => ({
                feedback: row.feedback,
                reviewedAt: row.reviewedAt.toISOString(),
              }));

      const payload = {
        masteryKey: masteryCardKey(card.id),
        card: {
          id: card.id,
          concept: card.concept,
          example: card.example,
          confusionPoint: card.confusionPoint,
          tags: card.tags,
          source: card.source,
          documentId: card.documentId,
          topicId: card.topicId,
          mapNodeId: card.mapNodeId,
          anchorText: card.anchorText,
          anchorBlock: card.anchorBlock,
        },
        questions: questionRows.map((row) => toPublicQuestion(row)),
        existingQuestionTypes: [...new Set(questionRows.map((row) => row.type))],
        reviewState: state
          ? {
              ease: state.ease,
              intervalDays: state.intervalDays,
              dueAt: state.dueAt.toISOString(),
              reps: state.reps,
              lapses: state.lapses,
              lastFeedback: state.lastFeedback,
            }
          : null,
        recentFeedback: recent,
        masteryMemory: memory?.content ?? null,
        splitChildren: splitChildren.map((child) => ({
          id: child.id,
          concept: child.concept,
        })),
      };
      return toolResult(JSON.stringify(payload), payload);
    },
  };
}

export const evolveWriteQuestionsSchema = Type.Object({
  cardId: Type.String({ minLength: 1, maxLength: 36 }),
  questions: Type.Array(
    Type.Object({
      type: Type.Union([Type.Literal('cloze'), Type.Literal('compare'), Type.Literal('judge')]),
      question: Type.String({ minLength: 1, maxLength: 2000 }),
      answer: Type.String({ minLength: 1, maxLength: 2000 }),
    }),
    { minItems: 1, maxItems: 1 },
  ),
});
export type EvolveWriteQuestionsArgs = Static<typeof evolveWriteQuestionsSchema>;

export function evolveWriteQuestionsTool(
  session: EvolveSession,
): AgentTool<typeof evolveWriteQuestionsSchema> {
  return {
    name: 'write_questions',
    label: '追加自测题',
    description:
      '为指定卡片追加 1 道自测题（只插入，旧题保留）。fuzzy：只能给原卡出题，题型必须和已有题不同。repeated_forgot：只能给 split_card 返回的子卡出题。',
    parameters: evolveWriteQuestionsSchema,
    execute: async (_id, params) => {
      const allowed = allowedQuestionCardIds(session);
      if (!allowed.has(params.cardId)) {
        throw new Error(
          session.reason === 'fuzzy'
            ? 'fuzzy 只能给原卡追加题目'
            : 'repeated_forgot 只能给 split_card 返回的子卡出题，请先 split_card',
        );
      }
      const [card] = await getDb()
        .select()
        .from(cards)
        .where(and(eq(cards.id, params.cardId), eq(cards.userId, session.userId)))
        .limit(1);
      if (!card) throw new Error('card not found');

      if (session.reason === 'fuzzy') {
        const existing = await getDb()
          .select({ type: cardQuestions.type })
          .from(cardQuestions)
          .where(eq(cardQuestions.cardId, card.id));
        const existingTypes = [...new Set(existing.map((row) => row.type))];
        const nextType = params.questions[0]?.type;
        if (
          nextType &&
          existingTypes.length < 3 &&
          existingTypes.includes(nextType)
        ) {
          throw new Error(
            `新题型必须和已有题不同（已有：${existingTypes.join(', ') || '无'}）`,
          );
        }
      }

      const inserted: { id: string; type: string; cardId: string }[] = [];
      for (const q of params.questions) {
        const [row] = await getDb()
          .insert(cardQuestions)
          .values({
            cardId: card.id,
            type: q.type,
            question: q.question.trim(),
            answer: q.answer.trim(),
          })
          .returning();
        if (!row) throw new Error('failed to insert question');
        session.writtenQuestionIds.push(row.id);
        inserted.push({ id: row.id, type: row.type, cardId: card.id });
      }
      return toolResult(JSON.stringify({ cardId: card.id, questions: inserted }), inserted);
    },
  };
}

const splitChildSchema = Type.Object({
  concept: Type.String({ minLength: 1, maxLength: 2000 }),
  example: Type.String({ minLength: 1, maxLength: 4000 }),
  confusion_point: Type.String({ minLength: 1, maxLength: 2000 }),
  anchor_text: Type.Optional(Type.String({ minLength: 1, maxLength: 4000 })),
});

export const splitCardSchema = Type.Object({
  cardId: Type.String({ minLength: 1, maxLength: 36 }),
  children: Type.Array(splitChildSchema, { minItems: 1, maxItems: SPLIT_MAX_CHILDREN }),
});
export type SplitCardArgs = Static<typeof splitCardSchema>;

export async function loadSplitChildren(userId: string, parentId: string): Promise<CardRow[]> {
  const links = await getDb()
    .select()
    .from(cardLinks)
    .where(
      and(
        eq(cardLinks.userId, userId),
        eq(cardLinks.type, SPLIT_LINK_TYPE),
        eq(cardLinks.origin, 'agent'),
        eq(cardLinks.reason, SPLIT_LINK_REASON),
        or(eq(cardLinks.fromCardId, parentId), eq(cardLinks.toCardId, parentId)),
      ),
    );
  const childIds = [
    ...new Set(
      links.map((link) => (link.fromCardId === parentId ? link.toCardId : link.fromCardId)),
    ),
  ].filter((id) => id !== parentId);
  if (childIds.length === 0) return [];
  return getDb()
    .select()
    .from(cards)
    .where(and(eq(cards.userId, userId), inArray(cards.id, childIds)))
    .orderBy(asc(cards.createdAt), asc(cards.id));
}

async function linkSplitChild(userId: string, childId: string, parentId: string): Promise<void> {
  try {
    await getDb()
      .insert(cardLinks)
      .values({
        userId,
        fromCardId: childId,
        toCardId: parentId,
        type: SPLIT_LINK_TYPE,
        origin: 'agent',
        reason: SPLIT_LINK_REASON,
      });
  } catch (err) {
    if (!isUniqueViolation(err)) throw err;
  }
}

export function splitCardTool(session: EvolveSession): AgentTool<typeof splitCardSchema> {
  return {
    name: 'split_card',
    label: '拆小卡片',
    description:
      '把当前卡拆成 1-2 张更小范围的子卡。子卡 source=agent、与原卡同 document_id，自动建次日到期的复习状态，并与原卡建 related 边（reason=「由原卡拆小」）。原卡保留。若已经拆过，返回已有子卡。',
    parameters: splitCardSchema,
    execute: async (_id, params) => {
      if (session.reason !== 'repeated_forgot') {
        throw new Error('split_card 只用于 repeated_forgot');
      }
      if (params.cardId !== session.cardId) {
        throw new Error('cardId does not match the job card');
      }
      const [parent] = await getDb()
        .select()
        .from(cards)
        .where(and(eq(cards.id, session.cardId), eq(cards.userId, session.userId)))
        .limit(1);
      if (!parent) throw new Error('card not found');

      const existing = await loadSplitChildren(session.userId, parent.id);
      if (existing.length > 0) {
        for (const child of existing) {
          if (!session.splitChildIds.includes(child.id)) session.splitChildIds.push(child.id);
          if (!session.writtenCardIds.includes(child.id)) session.writtenCardIds.push(child.id);
        }
        const payload = {
          reused: true,
          parentId: parent.id,
          children: existing.map((child) => ({ id: child.id, concept: child.concept })),
        };
        return toolResult(JSON.stringify(payload), payload);
      }

      const document = parent.documentId
        ? (
            await getDb()
              .select()
              .from(documents)
              .where(and(eq(documents.id, parent.documentId), eq(documents.userId, session.userId)))
              .limit(1)
          )[0]
        : undefined;

      const created: { id: string; concept: string }[] = [];
      const createdIds: string[] = [];
      try {
        for (const draft of params.children) {
          const now = new Date();
          let anchorText = parent.anchorText;
          let anchorBlock = parent.anchorBlock;
          if (draft.anchor_text && document) {
            const resolved = resolveAnchor(document.contentMd, draft.anchor_text, parseAnchorBlock(1));
            anchorText = resolved.anchorText;
            anchorBlock = resolved.anchorBlock;
          } else if (draft.anchor_text) {
            anchorText = draft.anchor_text.trim();
          }
          const tags =
            parent.tags.length > 0 ? parent.tags : ['拆小'];
          const [row] = await getDb()
            .insert(cards)
            .values({
              userId: session.userId,
              documentId: parent.documentId,
              topicId: parent.topicId,
              mapNodeId: parent.mapNodeId,
              concept: draft.concept.trim(),
              example: draft.example.trim(),
              confusionPoint: draft.confusion_point.trim(),
              tags,
              source: 'agent',
              anchorText,
              anchorBlock,
            })
            .returning();
          if (!row) throw new Error('failed to insert child card');
          createdIds.push(row.id);
          try {
            await insertInitialReviewState(session.userId, row.id, now);
            await indexCard({
              id: row.id,
              userId: row.userId,
              topicId: row.topicId,
              concept: row.concept,
              example: row.example,
              confusionPoint: row.confusionPoint,
              tags: row.tags,
            });
          } catch (err) {
            logger.error('evolve.index_child_failed', err);
            try {
              await deleteCard(row.id);
            } catch (cleanupErr) {
              logger.warn('evolve.index_child_cleanup_failed', cleanupErr);
            }
            await getDb().delete(cards).where(eq(cards.id, row.id));
            throw err instanceof Error ? err : new Error('indexCard failed');
          }
          await linkSplitChild(session.userId, row.id, parent.id);
          session.writtenCardIds.push(row.id);
          session.splitChildIds.push(row.id);
          created.push({ id: row.id, concept: row.concept });
        }
      } catch (err) {
        for (const id of createdIds) {
          try {
            await deleteCard(id);
          } catch {
            /* ignore */
          }
          await getDb().delete(cards).where(eq(cards.id, id));
        }
        session.writtenCardIds = session.writtenCardIds.filter((id) => !createdIds.includes(id));
        session.splitChildIds = session.splitChildIds.filter((id) => !createdIds.includes(id));
        throw err;
      }

      if (parent.mapNodeId) {
        await recalculateMapNodeStatus(parent.mapNodeId);
      }

      const payload = { reused: false, parentId: parent.id, children: created };
      return toolResult(JSON.stringify(payload), payload);
    },
  };
}

export const writeMemorySchema = Type.Object({
  key: Type.Optional(Type.String({ minLength: 1, maxLength: 200 })),
  note: Type.String({ minLength: 1, maxLength: 2000 }),
});
export type WriteMemoryArgs = Static<typeof writeMemorySchema>;

export function writeMemoryTool(session: EvolveSession): AgentTool<typeof writeMemorySchema> {
  return {
    name: 'write_memory',
    label: '写入掌握度记忆',
    description:
      '写入 mastery memory（scope=user, layer=mastery）。key 默认 card:<当前卡id>。会与已有 content 合并，不会丢掉 recent 反馈。fuzzy 请写「第一次讲法没讲透，换了个角度」；repeated_forgot 请写拆分原因。',
    parameters: writeMemorySchema,
    execute: async (_id, params) => {
      const key = (params.key?.trim() || masteryCardKey(session.cardId)).slice(0, 200);
      const now = new Date();
      const existing = await loadUserMasteryMemory(getDb(), session.userId, key);
      const content = {
        ...(existing?.content ?? {}),
        note: params.note.trim(),
        lastEvolve: { reason: session.reason, at: now.toISOString() },
      };
      const row = await upsertUserMasteryMemory(getDb(), {
        userId: session.userId,
        key,
        content,
        now,
      });
      session.memoryWritten = true;
      const payload = { ok: true, id: row.id, key, layer: 'mastery' as const };
      return toolResult(JSON.stringify(payload), payload);
    },
  };
}

const MAX_LINKS_PER_CARD = 3;

export const evolveLinkCardsSchema = Type.Object({
  cardId: Type.String({ minLength: 1, maxLength: 36 }),
  targetCardId: Type.String({ minLength: 1, maxLength: 36 }),
  type: Type.Union([
    Type.Literal('same_concept'),
    Type.Literal('confusable'),
    Type.Literal('prerequisite'),
    Type.Literal('related'),
  ]),
  reason: Type.String({ minLength: 1, maxLength: 500 }),
});
export type EvolveLinkCardsArgs = Static<typeof evolveLinkCardsSchema>;

export function evolveLinkCardsTool(
  session: EvolveSession,
): AgentTool<typeof evolveLinkCardsSchema> {
  return {
    name: 'link_cards',
    label: '建立卡片关联',
    description:
      '在两张卡之间建边。split_card 已经为子卡建好 related（「由原卡拆小」），通常不必再调。origin 固定 agent。',
    parameters: evolveLinkCardsSchema,
    execute: async (_id, params) => {
      if (params.cardId === params.targetCardId) {
        return toolResult(JSON.stringify({ ok: false, reason: 'cannot link a card to itself' }), {
          ok: false,
        });
      }
      if (!(CARD_LINK_TYPES as readonly string[]).includes(params.type)) {
        return toolResult(JSON.stringify({ ok: false, reason: 'invalid link type' }), { ok: false });
      }
      const involved = new Set([session.cardId, ...session.writtenCardIds, ...session.splitChildIds]);
      if (!involved.has(params.cardId) && !involved.has(params.targetCardId)) {
        return toolResult(
          JSON.stringify({ ok: false, reason: 'link must involve the current card or a child from this run' }),
          { ok: false },
        );
      }
      const owned = await getDb()
        .select()
        .from(cards)
        .where(
          and(
            eq(cards.userId, session.userId),
            inArray(cards.id, [params.cardId, params.targetCardId]),
          ),
        );
      const from = owned.find((row) => row.id === params.cardId);
      const to = owned.find((row) => row.id === params.targetCardId);
      if (!from || !to) {
        return toolResult(JSON.stringify({ ok: false, reason: 'card not found' }), { ok: false });
      }
      const [countRow] = await getDb()
        .select({ n: count() })
        .from(cardLinks)
        .where(and(eq(cardLinks.userId, session.userId), eq(cardLinks.fromCardId, from.id)));
      if (Number(countRow?.n ?? 0) >= MAX_LINKS_PER_CARD) {
        return toolResult(
          JSON.stringify({
            ok: false,
            reason: `at most ${String(MAX_LINKS_PER_CARD)} links per card`,
          }),
          { ok: false },
        );
      }
      try {
        const [row] = await getDb()
          .insert(cardLinks)
          .values({
            userId: session.userId,
            fromCardId: from.id,
            toCardId: to.id,
            type: params.type as CardLinkType,
            origin: 'agent',
            reason: params.reason.trim(),
          })
          .returning();
        if (!row) throw new Error('failed to insert card link');
        const payload = {
          ok: true,
          id: row.id,
          fromCardId: row.fromCardId,
          toCardId: row.toCardId,
          type: row.type,
          origin: row.origin,
          reason: row.reason,
        };
        return toolResult(JSON.stringify(payload), payload);
      } catch (err) {
        if (isUniqueViolation(err)) {
          return toolResult(
            JSON.stringify({ ok: true, duplicate: true, reason: 'link already exists' }),
            { ok: true, duplicate: true },
          );
        }
        asToolError(err);
      }
    },
  };
}

export function evolveTools(session: EvolveSession): AgentTool[] {
  return [
    readCardTool(session),
    evolveWriteQuestionsTool(session),
    splitCardTool(session),
    writeMemoryTool(session),
    evolveLinkCardsTool(session),
  ];
}
