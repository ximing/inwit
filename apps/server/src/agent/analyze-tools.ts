import { Type, type Static } from '@earendil-works/pi-ai';
import type { AgentTool } from '@earendil-works/pi-agent-core';
import type { MemoryContent } from '@inwit/dto';
import { and, eq, gte, inArray, like, or, sql } from 'drizzle-orm';
import { getDb } from '../db/index.js';
import { isUniqueViolation } from '../db/pg.js';
import {
  cardLinks,
  cardQuestions,
  cards,
  documents,
  memories,
  reviewLogs,
  type CardRow,
  type MemoryRow,
} from '../db/schema.js';
import { loadUserMasteryMemory, upsertUserMasteryMemory } from '../review/mastery-memory.js';
import { getOwnedTopic } from '../topics/topic.service.js';
import { splitMarkdownBlocks } from './anchors.js';
import {
  ANALYZE_DOC_COOLDOWN_DAYS,
  ANALYZE_LOOKBACK_DAYS,
  ANALYZE_MAX_CARDS,
  ANALYZE_MAX_DOCUMENTS,
  ANALYZE_MIN_CARDS,
  ANALYZE_STRUGGLING_MIN_HITS,
  CONFUSABLE_LINK_TYPE,
  CONFUSABLE_MEMORY_PREFIX,
  capDocumentTitle,
  confusableMemoryKey,
  contrastDocTitle,
  documentOnCooldown,
  parseConfusableKey,
} from './analyze-logic.js';
import { asToolError, cardDraftSchema, writeCardsTool, writeQuestionsTool, type DigestSession } from './tools.js';

export interface AnalyzeSession {
  userId: string;
  digest: DigestSession;
  writtenQuestionIds: string[];
  linkedPairKeys: string[];
  memoryKeys: string[];
  memoryWritten: boolean;
  skippedDocument: boolean;
  wroteDocument: boolean;
  pairCardIds: [string, string] | null;
}

export interface StrugglingCardView {
  id: string;
  concept: string;
  example: string;
  confusionPoint: string;
  tags: string[];
  topicId: string | null;
  documentId: string | null;
  forgotCount: number;
  fuzzyCount: number;
  struggleCount: number;
}

export interface ConfusableMemoryView {
  key: string;
  cardIds: [string, string] | null;
  documentId: string | null;
  generatedAt: string | null;
  onCooldown: boolean;
  note: string | null;
}

export function createAnalyzeSession(userId: string): AnalyzeSession {
  const digest: DigestSession = {
    userId,
    documentId: '',
    writtenCardIds: [],
    cardSource: 'agent',
    dueImmediately: true,
  };
  return {
    userId,
    digest,
    writtenQuestionIds: [],
    linkedPairKeys: [],
    memoryKeys: [],
    memoryWritten: false,
    skippedDocument: false,
    wroteDocument: false,
    pairCardIds: null,
  };
}

function toolResult(text: string, details: unknown = null) {
  return { content: [{ type: 'text' as const, text }], details };
}

function asString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

export async function loadStrugglingCards(
  userId: string,
  now = new Date(),
): Promise<StrugglingCardView[]> {
  const cutoff = new Date(now.getTime() - ANALYZE_LOOKBACK_DAYS * 24 * 60 * 60 * 1000);
  const agg = await getDb()
    .select({
      cardId: reviewLogs.cardId,
      forgotCount: sql<number>`count(*) filter (where ${reviewLogs.feedback} = 'forgot')::int`,
      fuzzyCount: sql<number>`count(*) filter (where ${reviewLogs.feedback} = 'fuzzy')::int`,
      struggleCount: sql<number>`count(*)::int`,
    })
    .from(reviewLogs)
    .where(
      and(
        eq(reviewLogs.userId, userId),
        gte(reviewLogs.reviewedAt, cutoff),
        inArray(reviewLogs.feedback, ['forgot', 'fuzzy']),
      ),
    )
    .groupBy(reviewLogs.cardId)
    .having(sql`count(*) >= ${ANALYZE_STRUGGLING_MIN_HITS}`)
    .orderBy(sql`count(*) desc`);

  if (agg.length === 0) return [];
  const ids = agg.map((row) => row.cardId);
  const cardRows = await getDb()
    .select()
    .from(cards)
    .where(and(eq(cards.userId, userId), inArray(cards.id, ids)));
  const byId = new Map(cardRows.map((row) => [row.id, row]));
  const views: StrugglingCardView[] = [];
  for (const row of agg) {
    const card = byId.get(row.cardId);
    if (!card) continue;
    views.push({
      id: card.id,
      concept: card.concept,
      example: card.example,
      confusionPoint: card.confusionPoint,
      tags: card.tags,
      topicId: card.topicId,
      documentId: card.documentId,
      forgotCount: Number(row.forgotCount),
      fuzzyCount: Number(row.fuzzyCount),
      struggleCount: Number(row.struggleCount),
    });
  }
  return views;
}

export async function loadConfusableMemories(
  userId: string,
  now = new Date(),
): Promise<ConfusableMemoryView[]> {
  const rows = await getDb()
    .select()
    .from(memories)
    .where(
      and(
        eq(memories.userId, userId),
        eq(memories.scope, 'user'),
        eq(memories.layer, 'mastery'),
        like(memories.key, `${CONFUSABLE_MEMORY_PREFIX}%`),
      ),
    );
  return rows.map((row) => memoryViewFromRow(row, now));
}

function memoryViewFromRow(row: MemoryRow, now: Date): ConfusableMemoryView {
  const parsed = parseConfusableKey(row.key);
  const cardIds = parsed ? ([parsed.a, parsed.b] as [string, string]) : null;
  return {
    key: row.key,
    cardIds,
    documentId: asString(row.content.documentId),
    generatedAt: asString(row.content.generatedAt),
    onCooldown: documentOnCooldown(row.content, now),
    note: asString(row.content.note),
  };
}

async function loadConfusableLinks(userId: string, cardIds: string[]) {
  if (cardIds.length === 0) return [];
  return getDb()
    .select({
      id: cardLinks.id,
      fromCardId: cardLinks.fromCardId,
      toCardId: cardLinks.toCardId,
      reason: cardLinks.reason,
    })
    .from(cardLinks)
    .where(
      and(
        eq(cardLinks.userId, userId),
        eq(cardLinks.type, CONFUSABLE_LINK_TYPE),
        or(inArray(cardLinks.fromCardId, cardIds), inArray(cardLinks.toCardId, cardIds)),
      ),
    );
}

async function loadOwnedCards(userId: string, ids: string[]): Promise<CardRow[]> {
  if (ids.length === 0) return [];
  return getDb()
    .select()
    .from(cards)
    .where(and(eq(cards.userId, userId), inArray(cards.id, ids)));
}

function trackMemoryKey(session: AnalyzeSession, key: string): void {
  if (!session.memoryKeys.includes(key)) session.memoryKeys.push(key);
  session.memoryWritten = true;
}

async function upsertConfusableMemory(
  session: AnalyzeSession,
  input: {
    cardA: CardRow;
    cardB: CardRow;
    note: string;
    documentId?: string | null;
    generatedAt?: string | null;
    now?: Date;
  },
): Promise<{ id: string; key: string }> {
  const now = input.now ?? new Date();
  const key = confusableMemoryKey(input.cardA.id, input.cardB.id);
  const existing = await loadUserMasteryMemory(getDb(), session.userId, key);
  const documentId = input.documentId ?? asString(existing?.content.documentId);
  const generatedAt =
    input.generatedAt ??
    (documentId ? (asString(existing?.content.generatedAt) ?? now.toISOString()) : asString(existing?.content.generatedAt));
  const content: MemoryContent = {
    ...(existing?.content ?? {}),
    note: input.note.trim(),
    cardIds: [input.cardA.id, input.cardB.id].sort(),
    concepts: [input.cardA.concept, input.cardB.concept],
    lastAnalyze: { at: now.toISOString() },
  };
  if (documentId) content.documentId = documentId;
  if (generatedAt) content.generatedAt = generatedAt;
  const row = await upsertUserMasteryMemory(getDb(), {
    userId: session.userId,
    key,
    content,
    now,
  });
  trackMemoryKey(session, key);
  return { id: row.id, key };
}

async function findConfusableLink(userId: string, a: string, b: string) {
  const [row] = await getDb()
    .select()
    .from(cardLinks)
    .where(
      and(
        eq(cardLinks.userId, userId),
        eq(cardLinks.type, CONFUSABLE_LINK_TYPE),
        or(
          and(eq(cardLinks.fromCardId, a), eq(cardLinks.toCardId, b)),
          and(eq(cardLinks.fromCardId, b), eq(cardLinks.toCardId, a)),
        ),
      ),
    )
    .limit(1);
  return row;
}

export const readStrugglingCardsSchema = Type.Object({});
export type ReadStrugglingCardsArgs = Static<typeof readStrugglingCardsSchema>;

export function readStrugglingCardsTool(
  session: AnalyzeSession,
): AgentTool<typeof readStrugglingCardsSchema> {
  return {
    name: 'read_struggling_cards',
    label: '读取困难卡片',
    description:
      '读取近 30 天 forgot/fuzzy 累计 ≥2 次的卡片（概念、例子、易混点、标签、主题），以及已有 confusable 边和 mastery memory。必须先调用。',
    parameters: readStrugglingCardsSchema,
    execute: async () => {
      const now = new Date();
      const struggling = await loadStrugglingCards(session.userId, now);
      const [links, memoriesView] = await Promise.all([
        loadConfusableLinks(
          session.userId,
          struggling.map((card) => card.id),
        ),
        loadConfusableMemories(session.userId, now),
      ]);
      const payload = {
        lookbackDays: ANALYZE_LOOKBACK_DAYS,
        minHits: ANALYZE_STRUGGLING_MIN_HITS,
        cooldownDays: ANALYZE_DOC_COOLDOWN_DAYS,
        cards: struggling,
        confusableLinks: links,
        confusableMemories: memoriesView,
        hint: '选出语义相近、都在反复错的成对概念。已有 documentId 且 onCooldown=true 的 pair 30 天内不要再 write_document。',
      };
      return toolResult(JSON.stringify(payload), payload);
    },
  };
}

export const analyzeLinkCardsSchema = Type.Object({
  cardId: Type.String({ minLength: 1, maxLength: 36 }),
  targetCardId: Type.String({ minLength: 1, maxLength: 36 }),
  reason: Type.String({ minLength: 1, maxLength: 500 }),
});
export type AnalyzeLinkCardsArgs = Static<typeof analyzeLinkCardsSchema>;

export function analyzeLinkCardsTool(
  session: AnalyzeSession,
): AgentTool<typeof analyzeLinkCardsSchema> {
  return {
    name: 'link_cards',
    label: '建立易混淆边',
    description:
      '在两张困难卡之间建 confusable 边（origin=agent）。同一对已有边则返回 duplicate。reason 用人话写清为什么容易搞混。',
    parameters: analyzeLinkCardsSchema,
    execute: async (_id, params) => {
      if (params.cardId === params.targetCardId) {
        return toolResult(JSON.stringify({ ok: false, reason: 'cannot link a card to itself' }), {
          ok: false,
        });
      }
      const owned = await loadOwnedCards(session.userId, [params.cardId, params.targetCardId]);
      const from = owned.find((row) => row.id === params.cardId);
      const to = owned.find((row) => row.id === params.targetCardId);
      if (!from || !to) {
        return toolResult(JSON.stringify({ ok: false, reason: 'card not found' }), { ok: false });
      }
      const key = confusableMemoryKey(from.id, to.id);
      const existing = await findConfusableLink(session.userId, from.id, to.id);
      if (existing) {
        if (!session.linkedPairKeys.includes(key)) session.linkedPairKeys.push(key);
        return toolResult(
          JSON.stringify({
            ok: true,
            duplicate: true,
            id: existing.id,
            key,
            type: CONFUSABLE_LINK_TYPE,
          }),
          { ok: true, duplicate: true, key },
        );
      }
      try {
        const [row] = await getDb()
          .insert(cardLinks)
          .values({
            userId: session.userId,
            fromCardId: from.id,
            toCardId: to.id,
            type: CONFUSABLE_LINK_TYPE,
            origin: 'agent',
            reason: params.reason.trim(),
          })
          .returning();
        if (!row) throw new Error('failed to insert card link');
        if (!session.linkedPairKeys.includes(key)) session.linkedPairKeys.push(key);
        const payload = {
          ok: true,
          id: row.id,
          key,
          fromCardId: row.fromCardId,
          toCardId: row.toCardId,
          type: row.type,
          origin: row.origin,
          reason: row.reason,
        };
        return toolResult(JSON.stringify(payload), payload);
      } catch (err) {
        if (isUniqueViolation(err)) {
          if (!session.linkedPairKeys.includes(key)) session.linkedPairKeys.push(key);
          return toolResult(
            JSON.stringify({ ok: true, duplicate: true, key, reason: 'link already exists' }),
            { ok: true, duplicate: true, key },
          );
        }
        asToolError(err);
      }
    },
  };
}

export const analyzeWriteMemorySchema = Type.Object({
  cardIdA: Type.String({ minLength: 1, maxLength: 36 }),
  cardIdB: Type.String({ minLength: 1, maxLength: 36 }),
  note: Type.String({ minLength: 1, maxLength: 2000 }),
});
export type AnalyzeWriteMemoryArgs = Static<typeof analyzeWriteMemorySchema>;

export function analyzeWriteMemoryTool(
  session: AnalyzeSession,
): AgentTool<typeof analyzeWriteMemorySchema> {
  return {
    name: 'write_memory',
    label: '写入混淆对记忆',
    description:
      '写入 mastery memory。key 固定为 confusable:<较小id>+<较大id>。请给每一对混淆概念都写一条，说明为什么容易搞混。已有 content（documentId / generatedAt）会保留。',
    parameters: analyzeWriteMemorySchema,
    execute: async (_id, params) => {
      if (params.cardIdA === params.cardIdB) {
        throw new Error('cardIdA and cardIdB must be different');
      }
      const owned = await loadOwnedCards(session.userId, [params.cardIdA, params.cardIdB]);
      const cardA = owned.find((row) => row.id === params.cardIdA);
      const cardB = owned.find((row) => row.id === params.cardIdB);
      if (!cardA || !cardB) throw new Error('card not found');
      const documentId = session.digest.documentId || null;
      const now = new Date();
      const row = await upsertConfusableMemory(session, {
        cardA,
        cardB,
        note: params.note,
        documentId,
        generatedAt: documentId ? now.toISOString() : null,
        now,
      });
      const payload = { ok: true, id: row.id, key: row.key, layer: 'mastery' as const };
      return toolResult(JSON.stringify(payload), payload);
    },
  };
}

export const analyzeWriteDocumentSchema = Type.Object({
  cardIdA: Type.String({ minLength: 1, maxLength: 36 }),
  cardIdB: Type.String({ minLength: 1, maxLength: 36 }),
  title: Type.Optional(Type.String({ minLength: 1, maxLength: 200 })),
  contentMd: Type.String({ minLength: 20, maxLength: 100_000 }),
  topicId: Type.Optional(Type.String({ minLength: 1, maxLength: 36 })),
});
export type AnalyzeWriteDocumentArgs = Static<typeof analyzeWriteDocumentSchema>;

export function analyzeWriteDocumentTool(
  session: AnalyzeSession,
): AgentTool<typeof analyzeWriteDocumentSchema> {
  return {
    name: 'write_document',
    label: '写入对比专题文档',
    description:
      '为最强的一对混淆概念写一篇对比专题（source=agent）。标题默认「对比专题：A vs B」。正文用表格或对照段落讲清区别，并写 2-3 句可被逐字引用的对比句，供随后 write_cards 做 anchor_text。同一对 30 天内已出过专题则返回已有文档，不要再写。本轮最多 1 篇。两卡同主题时会自动挂到该主题。',
    parameters: analyzeWriteDocumentSchema,
    execute: async (_id, params) => {
      if (params.cardIdA === params.cardIdB) {
        throw new Error('cardIdA and cardIdB must be different');
      }
      const owned = await loadOwnedCards(session.userId, [params.cardIdA, params.cardIdB]);
      const cardA = owned.find((row) => row.id === params.cardIdA);
      const cardB = owned.find((row) => row.id === params.cardIdB);
      if (!cardA || !cardB) throw new Error('card not found');

      const key = confusableMemoryKey(cardA.id, cardB.id);
      const now = new Date();
      const existing = await loadUserMasteryMemory(getDb(), session.userId, key);

      if (session.wroteDocument || (session.digest.documentId && session.digest.documentId.length > 0)) {
        const payload = {
          reused: true,
          skipped: session.skippedDocument,
          documentId: session.digest.documentId,
          key,
          reason: `本轮最多 ${String(ANALYZE_MAX_DOCUMENTS)} 篇对比专题`,
        };
        return toolResult(JSON.stringify(payload), payload);
      }

      if (documentOnCooldown(existing?.content, now)) {
        const documentId = asString(existing?.content.documentId);
        if (documentId) {
          session.digest.documentId = documentId;
          session.skippedDocument = true;
          session.pairCardIds = [cardA.id, cardB.id];
          trackMemoryKey(session, key);
          const payload = {
            reused: true,
            skipped: true,
            documentId,
            key,
            reason: '同一混淆对 30 天内已生成过对比专题，不重复写',
          };
          return toolResult(JSON.stringify(payload), payload);
        }
      }

      let topicId: string | null = null;
      const requestedTopic = params.topicId?.trim();
      const sharedTopic =
        cardA.topicId && cardA.topicId === cardB.topicId ? cardA.topicId : null;
      const candidate = requestedTopic || sharedTopic;
      if (candidate) {
        try {
          const topic = await getOwnedTopic(session.userId, candidate);
          if (topic.status === 'active') topicId = topic.id;
        } catch (err) {
          asToolError(err);
        }
      }

      const title = capDocumentTitle(
        params.title?.trim() || contrastDocTitle(cardA.concept, cardB.concept),
      );
      const contentMd = params.contentMd.trim();
      const [row] = await getDb()
        .insert(documents)
        .values({
          userId: session.userId,
          topicId,
          title,
          contentMd,
          source: 'agent',
          status: 'digested',
        })
        .returning();
      if (!row) throw new Error('failed to insert document');

      session.digest.documentId = row.id;
      session.digest.topicId = topicId;
      session.wroteDocument = true;
      session.pairCardIds = [cardA.id, cardB.id];

      await upsertConfusableMemory(session, {
        cardA,
        cardB,
        note: asString(existing?.content.note) ?? `对比专题：${cardA.concept} vs ${cardB.concept}`,
        documentId: row.id,
        generatedAt: now.toISOString(),
        now,
      });

      const existingLink = await findConfusableLink(session.userId, cardA.id, cardB.id);
      if (!existingLink) {
        try {
          await getDb().insert(cardLinks).values({
            userId: session.userId,
            fromCardId: cardA.id,
            toCardId: cardB.id,
            type: CONFUSABLE_LINK_TYPE,
            origin: 'agent',
            reason: `对比专题：${cardA.concept} vs ${cardB.concept}`,
          });
          if (!session.linkedPairKeys.includes(key)) session.linkedPairKeys.push(key);
        } catch (err) {
          if (!isUniqueViolation(err)) asToolError(err);
          if (!session.linkedPairKeys.includes(key)) session.linkedPairKeys.push(key);
        }
      } else if (!session.linkedPairKeys.includes(key)) {
        session.linkedPairKeys.push(key);
      }

      const payload = {
        reused: false,
        skipped: false,
        id: row.id,
        title: row.title,
        topicId: row.topicId,
        source: row.source,
        status: row.status,
        key,
        blocks: splitMarkdownBlocks(row.contentMd),
      };
      return toolResult(JSON.stringify(payload), payload);
    },
  };
}

export const analyzeWriteCardsSchema = Type.Object({
  cards: Type.Array(cardDraftSchema, { minItems: ANALYZE_MIN_CARDS, maxItems: ANALYZE_MAX_CARDS }),
});
export type AnalyzeWriteCardsArgs = Static<typeof analyzeWriteCardsSchema>;

export function analyzeWriteCardsTool(
  session: AnalyzeSession,
): AgentTool<typeof analyzeWriteCardsSchema> {
  const inner = writeCardsTool(session.digest);
  return {
    name: 'write_cards',
    label: '写入对比卡片',
    description:
      '把 2-3 张对比卡挂到刚写入的专题文档。anchor_text 必须是文档里的原句。每张卡随后必须 write_questions 出 1 道 compare 或 judge。卡片会进入今日复习队列。',
    parameters: analyzeWriteCardsSchema,
    execute: async (id, params, signal, onUpdate) => {
      if (!session.digest.documentId) {
        throw new Error('请先 write_document 再 write_cards');
      }
      if (session.skippedDocument && !session.wroteDocument) {
        throw new Error('该混淆对 30 天内已有专题，不要再写卡');
      }
      if (session.digest.writtenCardIds.length > 0) {
        const payload = {
          reused: true,
          cards: session.digest.writtenCardIds.map((cardId) => ({ id: cardId })),
        };
        return toolResult(JSON.stringify(payload), payload);
      }
      return inner.execute(id, params, signal, onUpdate);
    },
  };
}

export const analyzeWriteQuestionsSchema = Type.Object({
  cardId: Type.String({ minLength: 1, maxLength: 36 }),
  questions: Type.Array(
    Type.Object({
      type: Type.Union([Type.Literal('compare'), Type.Literal('judge')]),
      question: Type.String({ minLength: 1, maxLength: 2000 }),
      answer: Type.String({ minLength: 1, maxLength: 2000 }),
    }),
    { minItems: 1, maxItems: 1 },
  ),
});
export type AnalyzeWriteQuestionsArgs = Static<typeof analyzeWriteQuestionsSchema>;

export function analyzeWriteQuestionsTool(
  session: AnalyzeSession,
): AgentTool<typeof analyzeWriteQuestionsSchema> {
  const inner = writeQuestionsTool(session.digest);
  return {
    name: 'write_questions',
    label: '写入对比题',
    description:
      '给 write_cards 返回的对比卡追加 1 道 compare 或 judge 题。每张新卡都要出题。不要出 cloze。',
    parameters: analyzeWriteQuestionsSchema,
    execute: async (id, params, signal, onUpdate) => {
      if (!session.digest.writtenCardIds.includes(params.cardId)) {
        throw new Error('只能给本轮 write_cards 写入的对比卡出题');
      }
      const result = await inner.execute(
        id,
        {
          cardId: params.cardId,
          questions: params.questions,
        },
        signal,
        onUpdate,
      );
      const inserted = await getDb()
        .select({ id: cardQuestions.id })
        .from(cardQuestions)
        .where(eq(cardQuestions.cardId, params.cardId));
      for (const row of inserted) {
        if (!session.writtenQuestionIds.includes(row.id)) session.writtenQuestionIds.push(row.id);
      }
      return result;
    },
  };
}

export function analyzeTools(session: AnalyzeSession): AgentTool[] {
  return [
    readStrugglingCardsTool(session),
    analyzeLinkCardsTool(session),
    analyzeWriteMemoryTool(session),
    analyzeWriteDocumentTool(session),
    analyzeWriteCardsTool(session),
    analyzeWriteQuestionsTool(session),
  ];
}
