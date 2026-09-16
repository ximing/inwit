import { Type, type Static } from '@earendil-works/pi-ai';
import type { AgentTool } from '@earendil-works/pi-agent-core';
import { and, asc, eq } from 'drizzle-orm';
import { getDb } from '../db/index.js';
import { cards, documents, memories, topics } from '../db/schema.js';
import { applyTopicOutline } from '../maps/apply.js';
import { getOwnedMapNode, getTopicMapFlat, updateMapNode } from '../maps/map.service.js';
import { TOPIC_MAP_SNAPSHOT_AFTER } from '../maps/snapshot.js';
import { titleFromDoc } from '@inwit/dto';
import { asPmJson, markdownToContentJson } from '../documents/content-json.js';
import { numberedBlocksFromDoc } from './card-anchor-logic.js';
import {
  asToolError,
  cardDraftSchema,
  placeOnMapTool,
  writeCardsTool,
  writeQuestionsTool,
  type DigestSession,
} from './tools.js';

function toolResult(text: string, details: unknown = null) {
  return { content: [{ type: 'text' as const, text }], details };
}

const outlineLeafSchema = Type.Object({
  id: Type.Optional(Type.String({ minLength: 1, maxLength: 36 })),
  title: Type.String({ minLength: 1, maxLength: 200 }),
  note: Type.Optional(Type.String({ maxLength: 4000 })),
  uncovered: Type.Optional(Type.Boolean()),
  cardIds: Type.Optional(Type.Array(Type.String({ minLength: 1, maxLength: 36 }))),
  documentIds: Type.Optional(Type.Array(Type.String({ minLength: 1, maxLength: 36 }))),
});

const outlineMidSchema = Type.Object({
  id: Type.Optional(Type.String({ minLength: 1, maxLength: 36 })),
  title: Type.String({ minLength: 1, maxLength: 200 }),
  note: Type.Optional(Type.String({ maxLength: 4000 })),
  uncovered: Type.Optional(Type.Boolean()),
  cardIds: Type.Optional(Type.Array(Type.String({ minLength: 1, maxLength: 36 }))),
  documentIds: Type.Optional(Type.Array(Type.String({ minLength: 1, maxLength: 36 }))),
  children: Type.Optional(Type.Array(outlineLeafSchema)),
});

const outlineRootSchema = Type.Object({
  id: Type.Optional(Type.String({ minLength: 1, maxLength: 36 })),
  title: Type.String({ minLength: 1, maxLength: 200 }),
  note: Type.Optional(Type.String({ maxLength: 4000 })),
  uncovered: Type.Optional(Type.Boolean()),
  cardIds: Type.Optional(Type.Array(Type.String({ minLength: 1, maxLength: 36 }))),
  documentIds: Type.Optional(Type.Array(Type.String({ minLength: 1, maxLength: 36 }))),
  children: Type.Optional(Type.Array(outlineMidSchema)),
});

export const readTopicContextSchema = Type.Object({
  topicId: Type.String({ minLength: 1, maxLength: 36 }),
});
export type ReadTopicContextArgs = Static<typeof readTopicContextSchema>;

export function readTopicContextTool(session: DigestSession): AgentTool<typeof readTopicContextSchema> {
  return {
    name: 'read_topic_context',
    label: '读取主题上下文',
    description:
      '读取主题目标、全部卡片概念、全部资料标题、当前地图树，以及上次整理快照（若有）。整理前必须先调用。',
    parameters: readTopicContextSchema,
    execute: async (_id, params) => {
      if (params.topicId !== session.topicId) {
        throw new Error('topicId does not match the job topic');
      }
      try {
        const [topic] = await getDb()
          .select({ id: topics.id, title: topics.title, goal: topics.goal })
          .from(topics)
          .where(and(eq(topics.id, params.topicId), eq(topics.userId, session.userId)))
          .limit(1);
        if (!topic) throw new Error('topic not found');

        const cardRows = await getDb()
          .select({
            id: cards.id,
            concept: cards.concept,
            mapNodeId: cards.mapNodeId,
          })
          .from(cards)
          .where(and(eq(cards.userId, session.userId), eq(cards.topicId, params.topicId)))
          .orderBy(asc(cards.createdAt), asc(cards.id));

        const docRows = await getDb()
          .select({
            id: documents.id,
            title: documents.title,
            mapNodeId: documents.mapNodeId,
          })
          .from(documents)
          .where(and(eq(documents.userId, session.userId), eq(documents.topicId, params.topicId)))
          .orderBy(asc(documents.createdAt), asc(documents.id));

        const map = await getTopicMapFlat(session.userId, params.topicId);

        const [previous] = await getDb()
          .select({ content: memories.content, updatedAt: memories.updatedAt })
          .from(memories)
          .where(
            and(
              eq(memories.userId, session.userId),
              eq(memories.scope, 'topic'),
              eq(memories.scopeId, params.topicId),
              eq(memories.layer, 'topic_map'),
              eq(memories.key, TOPIC_MAP_SNAPSHOT_AFTER),
            ),
          )
          .limit(1);

        const payload = {
          topic,
          cards: cardRows.map((row) => ({
            id: row.id,
            concept: row.concept.slice(0, 200),
            mapNodeId: row.mapNodeId,
          })),
          documents: docRows.map((row) => ({
            id: row.id,
            title: (row.title ?? '').slice(0, 80),
            mapNodeId: row.mapNodeId,
          })),
          map,
          attachedCardCount: cardRows.filter((row) => row.mapNodeId).length,
          attachedDocumentCount: docRows.filter((row) => row.mapNodeId).length,
          previousSnapshotAt: previous?.updatedAt.toISOString() ?? null,
        };
        return toolResult(JSON.stringify(payload), payload);
      } catch (err) {
        asToolError(err);
      }
    },
  };
}

export const updateKnowledgeMapSchema = Type.Object({
  nodes: Type.Array(outlineRootSchema, { minItems: 1, maxItems: 40 }),
});
export type UpdateKnowledgeMapArgs = Static<typeof updateKnowledgeMapSchema>;

export function updateKnowledgeMapTool(
  session: DigestSession,
): AgentTool<typeof updateKnowledgeMapSchema> {
  return {
    name: 'update_knowledge_map',
    label: '写入整理后的地图',
    description:
      '用完整大纲树替换当前知识地图。已挂载的 cardId / documentId 必须全部出现在树里（只能移动不能丢）。空白概念设 uncovered=true 且不要挂卡。已有节点请带上 id。',
    parameters: updateKnowledgeMapSchema,
    execute: async (_id, params) => {
      if (!session.topicId) throw new Error('missing topicId');
      try {
        const result = await applyTopicOutline({
          userId: session.userId,
          topicId: session.topicId,
          roots: params.nodes,
        });
        session.mapUpdated = true;
        return toolResult(JSON.stringify({ ok: true, ...result }), result);
      } catch (err) {
        asToolError(err);
      }
    },
  };
}

export const readMapNodeSchema = Type.Object({
  nodeId: Type.String({ minLength: 1, maxLength: 36 }),
});
export type ReadMapNodeArgs = Static<typeof readMapNodeSchema>;

export function readMapNodeTool(session: DigestSession): AgentTool<typeof readMapNodeSchema> {
  return {
    name: 'read_map_node',
    label: '读取空白节点',
    description: '读取当前要补的地图节点、路径、主题目标和该节点已有卡片。补卡前必须先调用。',
    parameters: readMapNodeSchema,
    execute: async (_id, params) => {
      if (session.mapNodeId && params.nodeId !== session.mapNodeId) {
        throw new Error('nodeId does not match the job node');
      }
      try {
        const node = await getOwnedMapNode(session.userId, params.nodeId);
        if (session.topicId && node.topicId !== session.topicId) {
          throw new Error('node does not belong to this topic');
        }
        const [topic] = await getDb()
          .select({ id: topics.id, title: topics.title, goal: topics.goal })
          .from(topics)
          .where(eq(topics.id, node.topicId))
          .limit(1);
        const map = await getTopicMapFlat(session.userId, node.topicId);
        const self = map.find((item) => item.id === node.id);
        const nodeCards = await getDb()
          .select({ id: cards.id, concept: cards.concept })
          .from(cards)
          .where(and(eq(cards.userId, session.userId), eq(cards.mapNodeId, node.id)));
        const payload = {
          node: {
            id: node.id,
            title: node.title,
            note: node.note,
            status: node.status,
            path: self?.path ?? node.title,
            depth: self?.depth ?? 1,
          },
          topic: topic ?? null,
          existingCards: nodeCards,
        };
        return toolResult(JSON.stringify(payload), payload);
      } catch (err) {
        asToolError(err);
      }
    },
  };
}

export const writeDocumentSchema = Type.Object({
  title: Type.Optional(Type.String({ minLength: 1, maxLength: 200 })),
  contentMd: Type.String({ minLength: 20, maxLength: 20_000 }),
});
export type WriteDocumentArgs = Static<typeof writeDocumentSchema>;

export function writeFillDocumentTool(session: DigestSession): AgentTool<typeof writeDocumentSchema> {
  return {
    name: 'write_document',
    label: '写入入门文档',
    description:
      '把空白概念的入门讲解写入当前文档。必须先写文档再 write_cards。用 markdown，分段清楚，返回值含 numberedView 编号块视图，供 blockIndex + quote 引用。',
    parameters: writeDocumentSchema,
    execute: async (_id, params) => {
      if (!session.documentId) throw new Error('missing documentId');
      const contentMd = params.contentMd.trim();
      const contentJson = markdownToContentJson(contentMd);
      const title = params.title?.trim() || titleFromDoc(contentJson);
      const [row] = await getDb()
        .update(documents)
        .set({
          title,
          contentJson,
          updatedAt: new Date(),
        })
        .where(and(eq(documents.id, session.documentId), eq(documents.userId, session.userId)))
        .returning();
      if (!row) throw new Error('document not found');
      session.documentWritten = true;
      const { blocks, numberedView } = numberedBlocksFromDoc(asPmJson(row.contentJson));
      const payload = {
        id: row.id,
        title: row.title,
        blocks,
        numberedView,
      };
      return toolResult(JSON.stringify(payload), payload);
    },
  };
}

const fillWriteCardsSchema = Type.Object({
  cards: Type.Array(cardDraftSchema, { minItems: 1, maxItems: 2 }),
});

export function fillWriteCardsTool(session: DigestSession): AgentTool<typeof fillWriteCardsSchema> {
  const base = writeCardsTool(session);
  return {
    name: base.name,
    label: base.label,
    description:
      '为本空白概念写入 1-2 张入门卡片。必须先 write_document。每张卡要有概念、例子、易混点、标签，以及从入门文对应块内逐字引用的 blockIndex / quote。',
    parameters: fillWriteCardsSchema,
    execute: async (id, params) => {
      if (!session.documentWritten) {
        throw new Error('先调用 write_document 再 write_cards');
      }
      return base.execute(id, params);
    },
  };
}

export const updateNodeNoteSchema = Type.Object({
  nodeId: Type.String({ minLength: 1, maxLength: 36 }),
  note: Type.String({ minLength: 1, maxLength: 4000 }),
});
export type UpdateNodeNoteArgs = Static<typeof updateNodeNoteSchema>;

export function updateNodeNoteTool(session: DigestSession): AgentTool<typeof updateNodeNoteSchema> {
  return {
    name: 'update_node_note',
    label: '写入节点学习指引',
    description: '给当前空白节点写一句学习指引（怎么读入门卡、下一步学什么）。可选。',
    parameters: updateNodeNoteSchema,
    execute: async (_id, params) => {
      if (session.mapNodeId && params.nodeId !== session.mapNodeId) {
        throw new Error('nodeId does not match the job node');
      }
      try {
        const node = await updateMapNode(session.userId, params.nodeId, { note: params.note });
        const payload = { ok: true, nodeId: node.id, note: node.note };
        return toolResult(JSON.stringify(payload), payload);
      } catch (err) {
        asToolError(err);
      }
    },
  };
}

export function organizeTools(session: DigestSession): AgentTool[] {
  return [readTopicContextTool(session), updateKnowledgeMapTool(session)];
}

export function fillTools(session: DigestSession): AgentTool[] {
  return [
    readMapNodeTool(session),
    writeFillDocumentTool(session),
    fillWriteCardsTool(session),
    writeQuestionsTool(session),
    placeOnMapTool(session),
    updateNodeNoteTool(session),
  ];
}
