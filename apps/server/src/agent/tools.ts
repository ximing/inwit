import { Type, type Static } from '@earendil-works/pi-ai';
import type { AgentTool } from '@earendil-works/pi-agent-core';
import { CARD_LINK_TYPES, type CardLinkType, type CardSource } from '@inwit/dto';
import { and, count, eq, inArray } from 'drizzle-orm';
import { getDb } from '../db/index.js';
import { isUniqueViolation } from '../db/pg.js';
import { cardLinks, cardQuestions, cards, documents, topics } from '../db/schema.js';
import { asPmJson } from '../documents/content-json.js';
import { AppError } from '../errors.js';
import { getTopicMapFlat, placeCardOnMap, recalculateMapNodeStatus } from '../maps/map.service.js';
import { OutlineError, parsePlaceOnMapTarget } from '../maps/outline.js';
import { deleteCard, indexCard, searchCards } from '../retrieval/pipeline.js';
import { insertInitialReviewState } from '../review/state-init.js';
import { logger } from '../utils/logger.js';
import { readDocumentAnnotationsTool, searchAnnotationsTool } from './annotation-tools.js';
import { numberedBlocksFromDoc, resolveQuoteAnchor } from './card-anchor-logic.js';
import { persistDocumentMeta } from './doc-meta.js';
import { isUserOwnedTitle } from './doc-meta-logic.js';

export interface DigestSession {
  userId: string;
  documentId: string;
  writtenCardIds: string[];
  cardSource?: CardSource;
  dueImmediately?: boolean;
  topicId?: string | null;
  mapNodeId?: string | null;
  documentWritten?: boolean;
  mapUpdated?: boolean;
  documentMetaWritten?: boolean;
}

export function asToolError(err: unknown): never {
  if (err instanceof OutlineError) throw new Error(err.message);
  if (err instanceof AppError) {
    const extra = err.details === undefined ? '' : `: ${typeof err.details === 'string' ? err.details : JSON.stringify(err.details)}`;
    throw new Error(`${err.message}${extra}`);
  }
  throw err;
}

function toolResult(text: string, details: unknown = null) {
  return { content: [{ type: 'text' as const, text }], details };
}

export const cardDraftSchema = Type.Object({
  concept: Type.String({ minLength: 1, maxLength: 2000 }),
  example: Type.String({ minLength: 1, maxLength: 4000 }),
  confusion_point: Type.String({ minLength: 1, maxLength: 2000 }),
  tags: Type.Array(Type.String({ minLength: 1, maxLength: 40 }), { minItems: 1, maxItems: 8 }),
  blockIndex: Type.Integer({ minimum: 1, maximum: 999 }),
  quote: Type.String({ minLength: 1, maxLength: 4000 }),
});

export const readDocumentSchema = Type.Object({
  documentId: Type.String({ minLength: 1, maxLength: 36 }),
});
export type ReadDocumentArgs = Static<typeof readDocumentSchema>;

export function readDocumentTool(session: DigestSession): AgentTool<typeof readDocumentSchema> {
  return {
    name: 'read_document',
    label: '读取文档',
    description:
      '读取当前文档的标题、编号块视图、主题归属和状态。必须先调用这个工具再切卡。numberedView 形如「[块 1 | 第 1 页] …」；引用原文时用 blockIndex + quote。',
    parameters: readDocumentSchema,
    execute: async (_id, params) => {
      if (params.documentId !== session.documentId) {
        throw new Error('documentId does not match the job document');
      }
      const [row] = await getDb()
        .select()
        .from(documents)
        .where(and(eq(documents.id, session.documentId), eq(documents.userId, session.userId)))
        .limit(1);
      if (!row) throw new Error('document not found');
      const { blocks, numberedView } = numberedBlocksFromDoc(asPmJson(row.contentJson));
      const payload = {
        id: row.id,
        title: row.title,
        description: row.description,
        titleLocked: isUserOwnedTitle(row.title),
        topicId: row.topicId,
        source: row.source,
        status: row.status,
        blocks,
        numberedView,
      };
      return toolResult(JSON.stringify(payload), payload);
    },
  };
}

export const writeCardsSchema = Type.Object({
  cards: Type.Array(cardDraftSchema, { minItems: 1, maxItems: 8 }),
});
export type WriteCardsArgs = Static<typeof writeCardsSchema>;

export function writeCardsTool(session: DigestSession): AgentTool<typeof writeCardsSchema> {
  return {
    name: 'write_cards',
    label: '写入卡片',
    description:
      '把原子卡片写入数据库并建立检索索引。每张卡必须包含一条概念、一个例子、一个易混点、若干标签，以及原文结构化引用 blockIndex（1 起计的块序号）和该块内的精确 quote。一次写入 2 张或以上。quote 校验失败仍建卡，只是无锚。',
    parameters: writeCardsSchema,
    execute: async (_id, params) => {
      const [document] = await getDb()
        .select()
        .from(documents)
        .where(and(eq(documents.id, session.documentId), eq(documents.userId, session.userId)))
        .limit(1);
      if (!document) throw new Error('document not found');

      const created: {
        id: string;
        concept: string;
        quote: string;
        blockIndex: number | null;
        anchored: boolean;
      }[] = [];
      const contentJson = asPmJson(document.contentJson);
      for (const draft of params.cards) {
        const now = new Date();
        const resolved = resolveQuoteAnchor(contentJson, draft.blockIndex, draft.quote);
        const [row] = await getDb()
          .insert(cards)
          .values({
            userId: session.userId,
            documentId: document.id,
            topicId: document.topicId,
            mapNodeId: document.mapNodeId,
            concept: draft.concept.trim(),
            example: draft.example.trim(),
            confusionPoint: draft.confusion_point.trim(),
            tags: draft.tags.map((tag) => tag.trim()).filter((tag) => tag.length > 0),
            source: session.cardSource ?? 'agent',
            anchorText: resolved.anchorText,
            anchorBlockIndex: resolved.anchorBlockIndex,
          })
          .returning();
        if (!row) throw new Error('failed to insert card');
        try {
          await insertInitialReviewState(
            session.userId,
            row.id,
            now,
            getDb(),
            session.dueImmediately ? now : undefined,
          );
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
          logger.error('digest.index_card_failed', err);
          try {
            await deleteCard(row.id);
          } catch (cleanupErr) {
            logger.warn('digest.index_card_cleanup_failed', cleanupErr);
          }
          await getDb().delete(cards).where(eq(cards.id, row.id));
          throw err instanceof Error ? err : new Error('indexCard failed');
        }
        session.writtenCardIds.push(row.id);
        created.push({
          id: row.id,
          concept: row.concept,
          quote: resolved.anchorText,
          blockIndex: resolved.anchorBlockIndex,
          anchored: resolved.anchorBlockIndex != null,
        });
      }
      if (document.mapNodeId) {
        await recalculateMapNodeStatus(document.mapNodeId);
      }
      return toolResult(JSON.stringify({ cards: created }), created);
    },
  };
}

export const writeQuestionsSchema = Type.Object({
  cardId: Type.String({ minLength: 1, maxLength: 36 }),
  questions: Type.Array(
    Type.Object({
      type: Type.Union([Type.Literal('cloze'), Type.Literal('compare'), Type.Literal('judge')]),
      question: Type.String({ minLength: 1, maxLength: 2000 }),
      answer: Type.String({ minLength: 1, maxLength: 2000 }),
    }),
    { minItems: 1, maxItems: 2 },
  ),
});
export type WriteQuestionsArgs = Static<typeof writeQuestionsSchema>;

export function writeQuestionsTool(session: DigestSession): AgentTool<typeof writeQuestionsSchema> {
  return {
    name: 'write_questions',
    label: '写入自测题',
    description:
      '为指定卡片写入 1-2 道自测题。题型只能是 cloze（填空）、compare（对比）或 judge（判断对错）。每张刚写入的卡都必须出题。',
    parameters: writeQuestionsSchema,
    execute: async (_id, params) => {
      const [card] = await getDb()
        .select()
        .from(cards)
        .where(and(eq(cards.id, params.cardId), eq(cards.userId, session.userId)))
        .limit(1);
      if (!card) throw new Error('card not found');
      if (card.documentId !== session.documentId) throw new Error('card does not belong to this document');

      const inserted: { id: string; type: string }[] = [];
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
        inserted.push({ id: row.id, type: row.type });
      }
      return toolResult(JSON.stringify({ cardId: card.id, questions: inserted }), inserted);
    },
  };
}

export const searchUserMemoriesSchema = Type.Object({
  query: Type.String({ minLength: 1, maxLength: 500 }),
});
export type SearchUserMemoriesArgs = Static<typeof searchUserMemoriesSchema>;

async function searchOwnedCards(userId: string, query: string) {
  const ids = await searchCards(userId, query, 8);
  if (ids.length === 0) return [];
  const rows = await getDb().select().from(cards).where(eq(cards.userId, userId));
  const byId = new Map(rows.map((row) => [row.id, row]));
  return ids
    .map((id) => byId.get(id))
    .filter((row): row is NonNullable<typeof row> => row !== undefined)
    .map((row) => ({
      cardId: row.id,
      concept: row.concept,
      example: row.example,
      tags: row.tags,
    }));
}

export function searchUserMemoriesTool(
  session: DigestSession,
): AgentTool<typeof searchUserMemoriesSchema> {
  return {
    name: 'search_user_memories',
    label: '检索已有记忆',
    description:
      '用混合检索查找用户已有卡片。切卡前检索一次；切卡后再对每张新卡检索，只对高度相关的旧卡调用 link_cards。',
    parameters: searchUserMemoriesSchema,
    execute: async (_id, params) => {
      try {
        const hits = await searchOwnedCards(session.userId, params.query);
        return toolResult(JSON.stringify(hits), hits);
      } catch (err) {
        logger.warn('digest.search_memories_failed', err);
        return toolResult('[]', []);
      }
    },
  };
}

export const searchCardsSchema = searchUserMemoriesSchema;
export type SearchCardsArgs = SearchUserMemoriesArgs;

export function searchCardsTool(session: DigestSession): AgentTool<typeof searchCardsSchema> {
  return {
    name: 'search_cards',
    label: '检索已有卡片',
    description:
      '用混合检索查找用户已有卡片。回答前必须先检索，避免把已经消化过的概念再写成重复卡。若回答引用了已有卡，切卡后用 link_cards 建边。',
    parameters: searchCardsSchema,
    execute: async (_id, params) => {
      try {
        const hits = await searchOwnedCards(session.userId, params.query);
        return toolResult(JSON.stringify(hits), hits);
      } catch (err) {
        logger.warn('chat.search_cards_failed', err);
        return toolResult('[]', []);
      }
    },
  };
}

export const attributeTopicSchema = Type.Object({
  documentId: Type.String({ minLength: 1, maxLength: 36 }),
  topicId: Type.String({ minLength: 1, maxLength: 36 }),
  reason: Type.String({ minLength: 1, maxLength: 500 }),
});
export type AttributeTopicArgs = Static<typeof attributeTopicSchema>;

export function attributeTopicTool(session: DigestSession): AgentTool<typeof attributeTopicSchema> {
  return {
    name: 'attribute_topic',
    label: '软归属主题',
    description:
      '当文档没有 topicId、且内容与某个活跃主题高度相关时，把文档（及本次写出的卡片）软归属到该主题。不要强行归属。',
    parameters: attributeTopicSchema,
    execute: async (_id, params) => {
      if (params.documentId !== session.documentId) {
        throw new Error('documentId does not match the job document');
      }
      const [document] = await getDb()
        .select()
        .from(documents)
        .where(and(eq(documents.id, session.documentId), eq(documents.userId, session.userId)))
        .limit(1);
      if (!document) throw new Error('document not found');
      if (document.topicId) {
        return toolResult(
          JSON.stringify({ ok: false, reason: 'document already belongs to a topic' }),
          { ok: false },
        );
      }
      const [topic] = await getDb()
        .select()
        .from(topics)
        .where(and(eq(topics.id, params.topicId), eq(topics.userId, session.userId)))
        .limit(1);
      if (!topic) throw new Error('topic not found');
      if (topic.status !== 'active') {
        return toolResult(JSON.stringify({ ok: false, reason: 'topic is not active' }), { ok: false });
      }
      const now = new Date();
      await getDb()
        .update(documents)
        .set({ topicId: topic.id, updatedAt: now })
        .where(eq(documents.id, document.id));
      await getDb()
        .update(cards)
        .set({ topicId: topic.id, updatedAt: now })
        .where(and(eq(cards.documentId, document.id), eq(cards.userId, session.userId)));
      session.topicId = topic.id;
      return toolResult(
        JSON.stringify({ ok: true, topicId: topic.id, reason: params.reason }),
        { ok: true, topicId: topic.id },
      );
    },
  };
}

const LINK_TYPES = CARD_LINK_TYPES;
const MAX_LINKS_PER_CARD = 3;

export const linkCardsSchema = Type.Object({
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
export type LinkCardsArgs = Static<typeof linkCardsSchema>;

export function linkCardsTool(session: DigestSession): AgentTool<typeof linkCardsSchema> {
  return {
    name: 'link_cards',
    label: '建立卡片关联',
    description:
      '在新卡 cardId 与已有旧卡 targetCardId 之间建一条边。type 只能是 same_concept（同一概念的两种说法）、confusable（易混淆）、prerequisite（target 是 card 的前置）或 related。origin 固定为 agent。只在高置信时调用；每张新卡最多 3 条。reason 用人话写清为什么相关。',
    parameters: linkCardsSchema,
    execute: async (_id, params) => {
      if (params.cardId === params.targetCardId) {
        return toolResult(JSON.stringify({ ok: false, reason: 'cannot link a card to itself' }), {
          ok: false,
        });
      }
      if (!(LINK_TYPES as readonly string[]).includes(params.type)) {
        return toolResult(JSON.stringify({ ok: false, reason: 'invalid link type' }), { ok: false });
      }
      if (session.writtenCardIds.includes(params.targetCardId)) {
        return toolResult(
          JSON.stringify({ ok: false, reason: 'link to older cards only, not cards written in this run' }),
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
      const fromThisRun =
        session.writtenCardIds.includes(from.id) || from.documentId === session.documentId;
      if (!fromThisRun) {
        return toolResult(
          JSON.stringify({ ok: false, reason: 'cardId must be a card written for this document' }),
          { ok: false },
        );
      }

      const [countRow] = await getDb()
        .select({ n: count() })
        .from(cardLinks)
        .where(and(eq(cardLinks.userId, session.userId), eq(cardLinks.fromCardId, from.id)));
      if (Number(countRow?.n ?? 0) >= MAX_LINKS_PER_CARD) {
        return toolResult(
          JSON.stringify({
            ok: false,
            reason: `at most ${String(MAX_LINKS_PER_CARD)} links per new card`,
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
          targetConcept: to.concept,
        };
        return toolResult(JSON.stringify(payload), payload);
      } catch (err) {
        if (isUniqueViolation(err)) {
          const [existing] = await getDb()
            .select()
            .from(cardLinks)
            .where(
              and(
                eq(cardLinks.fromCardId, from.id),
                eq(cardLinks.toCardId, to.id),
                eq(cardLinks.type, params.type as CardLinkType),
              ),
            )
            .limit(1);
          return toolResult(
            JSON.stringify({
              ok: true,
              duplicate: true,
              id: existing?.id ?? null,
              reason: 'link already exists',
            }),
            { ok: true, duplicate: true },
          );
        }
        throw err;
      }
    },
  };
}

export const readTopicMapSchema = Type.Object({
  topicId: Type.String({ minLength: 1, maxLength: 36 }),
});
export type ReadTopicMapArgs = Static<typeof readTopicMapSchema>;

export function readTopicMapTool(session: DigestSession): AgentTool<typeof readTopicMapSchema> {
  return {
    name: 'read_topic_map',
    label: '读取主题地图',
    description:
      '读取主题知识地图的节点树（id / 标题 / 路径 / 状态）。把新卡挂到地图前必须先读。优先把卡挂到已有节点，不要每次大改章节。',
    parameters: readTopicMapSchema,
    execute: async (_id, params) => {
      try {
        const nodes = await getTopicMapFlat(session.userId, params.topicId);
        const payload = {
          topicId: params.topicId,
          nodes: nodes.map((node) => ({
            id: node.id,
            title: node.title,
            parentId: node.parentId,
            path: node.path,
            depth: node.depth,
            status: node.status,
            cardCount: node.cardCount,
            docCount: node.docCount,
          })),
        };
        return toolResult(JSON.stringify(payload), payload);
      } catch (err) {
        asToolError(err);
      }
    },
  };
}

export const placeOnMapSchema = Type.Object({
  cardId: Type.String({ minLength: 1, maxLength: 36 }),
  nodeId: Type.Optional(Type.String({ minLength: 1, maxLength: 36 })),
  newNode: Type.Optional(
    Type.Object({
      title: Type.String({ minLength: 1, maxLength: 200 }),
      parentId: Type.Optional(Type.String({ minLength: 1, maxLength: 36 })),
    }),
  ),
});
export type PlaceOnMapArgs = Static<typeof placeOnMapSchema>;

export function placeOnMapTool(session: DigestSession): AgentTool<typeof placeOnMapSchema> {
  return {
    name: 'place_on_map',
    label: '把卡片挂到地图',
    description:
      '把本轮新卡挂到主题地图上。优先传已有 nodeId；只有没有合适节点时才传 newNode（title + 可选 parentId）。地图最多三级，不要为每张卡都新建根节点。',
    parameters: placeOnMapSchema,
    execute: async (_id, params) => {
      if (!session.writtenCardIds.includes(params.cardId)) {
        return toolResult(
          JSON.stringify({ ok: false, reason: 'cardId must be a card written in this run' }),
          { ok: false },
        );
      }
      let target;
      try {
        target = parsePlaceOnMapTarget({
          ...(params.nodeId ? { nodeId: params.nodeId } : {}),
          ...(params.newNode
            ? {
                newNode: {
                  title: params.newNode.title,
                  ...(params.newNode.parentId ? { parentId: params.newNode.parentId } : {}),
                },
              }
            : {}),
        });
      } catch (err) {
        asToolError(err);
      }
      try {
        const placed = await placeCardOnMap(session.userId, params.cardId, target);
        const payload = { ok: true, ...placed };
        return toolResult(JSON.stringify(payload), payload);
      } catch (err) {
        asToolError(err);
      }
    },
  };
}

export const setDocumentMetaSchema = Type.Object({
  title: Type.Optional(Type.String({ maxLength: 80 })),
  description: Type.Optional(Type.String({ maxLength: 200 })),
});
export type SetDocumentMetaArgs = Static<typeof setDocumentMetaSchema>;

export function setDocumentMetaTool(session: DigestSession): AgentTool<typeof setDocumentMetaSchema> {
  return {
    name: 'set_document_meta',
    label: '写入文档标题和摘要',
    description:
      '切卡完成后调用。title 为不超过 20 字的名词短语（不要复读原文第一句）；description 为不超过 60 字的一两句摘要。若 read_document 返回 titleLocked=true，只写 description，不要改 title。内容太短无从概括时可省略字段。',
    parameters: setDocumentMetaSchema,
    execute: async (_id, params) => {
      const [row] = await getDb()
        .select({ title: documents.title, description: documents.description })
        .from(documents)
        .where(and(eq(documents.id, session.documentId), eq(documents.userId, session.userId)))
        .limit(1);
      if (!row) throw new Error('document not found');
      const written = await persistDocumentMeta({
        userId: session.userId,
        documentId: session.documentId,
        existingTitle: row.title,
        existingDescription: row.description,
        proposedTitle: params.title,
        proposedDescription: params.description,
      });
      if (written.wroteTitle || written.wroteDescription) {
        session.documentMetaWritten = true;
      }
      const payload = { ok: true, ...written };
      return toolResult(JSON.stringify(payload), payload);
    },
  };
}

export function digestTools(session: DigestSession): AgentTool[] {
  return [
    readDocumentTool(session),
    readDocumentAnnotationsTool(session),
    writeCardsTool(session),
    writeQuestionsTool(session),
    searchUserMemoriesTool(session),
    linkCardsTool(session),
    attributeTopicTool(session),
    readTopicMapTool(session),
    placeOnMapTool(session),
    setDocumentMetaTool(session),
  ];
}

const chatWriteCardsSchema = Type.Object({
  cards: Type.Array(cardDraftSchema, { minItems: 1, maxItems: 3 }),
});

export function chatWriteCardsTool(session: DigestSession): AgentTool<typeof chatWriteCardsSchema> {
  const base = writeCardsTool(session);
  return {
    name: base.name,
    label: base.label,
    description:
      '把本次问答的知识点写成 1-3 张原子卡片并建立检索索引。每张卡必须包含一条概念、一个例子、一个易混点、若干标签，以及从用户问题原文给出的 blockIndex（通常为 1）和精确 quote。quote 校验失败仍建卡，只是无锚。',
    parameters: chatWriteCardsSchema,
    execute: base.execute,
  };
}

export function chatTools(session: DigestSession): AgentTool[] {
  return [
    searchCardsTool(session),
    searchAnnotationsTool(session),
    chatWriteCardsTool(session),
    writeQuestionsTool(session),
    linkCardsTool(session),
    setDocumentMetaTool(session),
  ];
}
