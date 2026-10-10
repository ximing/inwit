import { Type } from '@earendil-works/pi-ai';
import type { AgentTool } from '@earendil-works/pi-agent-core';
import { DOCUMENT_TITLE_MAX, type ConversationAction } from '@inwit/dto';
import { and, desc, eq, ilike, isNull } from 'drizzle-orm';
import { getDb } from '../db/index.js';
import { documents } from '../db/schema.js';
import { asPmJson, documentPlainText, markdownToContentJson } from '../documents/content-json.js';
import { tryIndexOwnedDocument } from '../retrieval/document-index.js';
import { numberedBlocksFromDoc } from './card-anchor-logic.js';
import {
  documentEditRefusal,
  editRefusalReason,
  editRefusalStatus,
  formatMindNode,
  planMindNodeUpdate,
} from './conversation-logic.js';
import { sliceNumberedDocument } from './document-read-logic.js';
import { applyMindEditsTool, readDocumentMindTool } from './conversation-mind-tools.js';
import { applyMindNodeUpdate, loadMindNodeFacts, mindNodeAllowed } from './conversation-nodes.js';
import { cardDraftSchema, searchCardsTool, writeCardsTool, type DigestSession } from './tools.js';
import { memoryLoadTools } from './memory-tools.js';

export interface ConversationSession {
  userId: string;
  dirtyDocumentIds: ReadonlySet<string>;
  /** documentId:nodeId pairs the user attached in this conversation. */
  mindNodeKeys: ReadonlySet<string>;
  /** Documents this turn may restructure: mentions plus attached nodes. */
  mindDocumentIds: ReadonlySet<string>;
  allowCards: boolean;
  actions: ConversationAction[];
  writtenCardIds: string[];
}

function toolResult(text: string, details: unknown = null) {
  return { content: [{ type: 'text' as const, text }], details };
}

function plainClip(text: string, max: number): string {
  const chars = [...text.trim()];
  return chars.length <= max ? chars.join('') : chars.slice(0, max).join('');
}

function displayTitle(title: string | null | undefined): string {
  const trimmed = title?.trim() ?? '';
  return trimmed.length > 0 ? trimmed : '未命名文档';
}

function digestSession(session: ConversationSession, documentId: string): DigestSession {
  return {
    userId: session.userId,
    documentId,
    writtenCardIds: session.writtenCardIds,
    cardSource: 'agent',
    cardAcceptance: 'accepted',
  };
}

const readConversationDocumentSchema = Type.Object({
  documentId: Type.String({ minLength: 1, maxLength: 36 }),
  fromBlock: Type.Optional(Type.Integer({ minimum: 1, maximum: 100_000 })),
});

export function readConversationDocumentTool(
  session: ConversationSession,
): AgentTool<typeof readConversationDocumentSchema> {
  return {
    name: 'read_document',
    label: '读取文档',
    description:
      '读取用户自己的一篇文档，返回标题和编号块。PDF 读的是已经抽出的文字，不是文件缺页。一次大约 12000 字，停在整块边界。truncated 为真时后面还有，用返回的 nextBlock 作为 fromBlock 再读。unreadPages 是还没读完的页，含 page、下一块 blockIndex 和开头一句。开头一句只用于定位，不能当作划线引文。给后文章节做划线时，先按 unreadPages 跳到那一页，再从编号块里逐字抄标题。前文里仅仅提到后一章的句子不能当那一章的锚点。fromBlock 从 1 起，不写就是从头读。不要逐页把全文读完。',
    parameters: readConversationDocumentSchema,
    execute: async (_id, params) => {
      const [row] = await getDb()
        .select()
        .from(documents)
        .where(
          and(
            eq(documents.id, params.documentId),
            eq(documents.userId, session.userId),
            isNull(documents.deletedAt),
          ),
        )
        .limit(1);
      if (!row) return toolResult(JSON.stringify({ ok: false, reason: '找不到这篇文档' }));
      const { blocks } = numberedBlocksFromDoc(asPmJson(row.contentJson));
      const view = sliceNumberedDocument(blocks, {
        ...(params.fromBlock !== undefined ? { fromBlock: params.fromBlock } : {}),
      });
      const payload = {
        id: row.id,
        title: displayTitle(row.title),
        fileMime: row.fileMime,
        kind: row.kind,
        numberedView: view.text,
        truncated: view.truncated,
        fromBlock: view.fromBlock,
        throughBlock: view.throughBlock,
        nextBlock: view.nextBlock,
        blockCount: view.blockCount,
        unreadPages: view.unreadPages,
        unreadPageCount: view.unreadPageCount,
      };
      return toolResult(JSON.stringify(payload), payload);
    },
  };
}

const findDocumentsSchema = Type.Object({
  query: Type.String({ maxLength: 80 }),
});

export function findDocumentsTool(
  session: ConversationSession,
): AgentTool<typeof findDocumentsSchema> {
  return {
    name: 'find_documents',
    label: '查找文档',
    description: '按标题查找用户的文档，返回 id 和标题。query 为空时返回最近更新的几篇。',
    parameters: findDocumentsSchema,
    execute: async (_id, params) => {
      const needle = params.query.replace(/[%_\\]/g, '').trim();
      const conditions = [eq(documents.userId, session.userId), isNull(documents.deletedAt)];
      if (needle) conditions.push(ilike(documents.title, `%${needle}%`));
      const rows = await getDb()
        .select({
          id: documents.id,
          title: documents.title,
          description: documents.description,
        })
        .from(documents)
        .where(and(...conditions))
        .orderBy(desc(documents.updatedAt))
        .limit(8);
      const payload = rows.map((row) => ({
        id: row.id,
        title: displayTitle(row.title),
        description: row.description,
      }));
      return toolResult(JSON.stringify(payload), payload);
    },
  };
}

const updateDocumentSchema = Type.Object({
  documentId: Type.String({ minLength: 1, maxLength: 36 }),
  contentMd: Type.String({ maxLength: 100_000 }),
  title: Type.Optional(Type.String({ maxLength: 80 })),
});

export function updateDocumentTool(
  session: ConversationSession,
): AgentTool<typeof updateDocumentSchema> {
  return {
    name: 'update_document',
    label: '修改文档',
    description:
      '把一篇已有普通文档的正文替换为 contentMd（Markdown）。只改用户指定的部分，其余保持原意。PDF 和周报会失败。有未保存修改的文档会失败，不要换一篇重试。title 只在用户要求改标题时传入。不要用来新建文档。不要用 --- 当分隔线，那会被当成分页。',
    parameters: updateDocumentSchema,
    execute: async (_id, params) => {
      const [row] = await getDb()
        .select({
          id: documents.id,
          title: documents.title,
          fileMime: documents.fileMime,
          kind: documents.kind,
        })
        .from(documents)
        .where(
          and(
            eq(documents.id, params.documentId),
            eq(documents.userId, session.userId),
            isNull(documents.deletedAt),
          ),
        )
        .limit(1);
      const refusal = documentEditRefusal({
        found: Boolean(row),
        fileMime: row?.fileMime ?? null,
        kind: row?.kind ?? 'document',
        dirty: session.dirtyDocumentIds.has(params.documentId),
        markdown: params.contentMd,
      });
      const title = displayTitle(params.title?.trim() ? params.title : row?.title);
      if (refusal || !row) {
        const reason = editRefusalReason(refusal ?? 'missing');
        session.actions.push({
          type: 'update_document',
          documentId: params.documentId,
          title,
          status: editRefusalStatus(refusal ?? 'missing'),
          reason,
        });
        return toolResult(JSON.stringify({ ok: false, reason }), { ok: false, reason });
      }
      let contentJson: Record<string, unknown>;
      try {
        contentJson = markdownToContentJson(params.contentMd) as Record<string, unknown>;
      } catch (err) {
        const reason = err instanceof Error ? err.message : '正文无法写入';
        session.actions.push({
          type: 'update_document',
          documentId: row.id,
          title,
          status: 'rejected',
          reason,
        });
        return toolResult(JSON.stringify({ ok: false, reason }), { ok: false, reason });
      }
      if (documentPlainText(contentJson).trim().length === 0) {
        const reason = editRefusalReason('empty');
        session.actions.push({
          type: 'update_document',
          documentId: row.id,
          title,
          status: 'rejected',
          reason,
        });
        return toolResult(JSON.stringify({ ok: false, reason }), { ok: false, reason });
      }
      const nextTitle =
        params.title !== undefined && params.title.trim().length > 0
          ? plainClip(params.title, DOCUMENT_TITLE_MAX)
          : undefined;
      await getDb()
        .update(documents)
        .set({
          contentJson,
          updatedAt: new Date(),
          ...(nextTitle !== undefined ? { title: nextTitle } : {}),
        })
        .where(and(eq(documents.id, row.id), eq(documents.userId, session.userId)));
      await tryIndexOwnedDocument(session.userId, row.id);
      const savedTitle = nextTitle ?? displayTitle(row.title);
      session.actions.push({
        type: 'update_document',
        documentId: row.id,
        title: savedTitle,
        status: 'applied',
      });
      return toolResult(
        JSON.stringify({ ok: true, documentId: row.id, title: savedTitle }),
        { ok: true, documentId: row.id },
      );
    },
  };
}

const createConversationDocumentSchema = Type.Object({
  contentMd: Type.String({ minLength: 1, maxLength: 100_000 }),
  title: Type.Optional(Type.String({ maxLength: 80 })),
});

export function createConversationDocumentTool(
  session: ConversationSession,
): AgentTool<typeof createConversationDocumentSchema> {
  return {
    name: 'create_document',
    label: '新建文档',
    description:
      '用户要新写一篇、且没有指定要改的文档时调用。写入后不消化、不生成卡片。contentMd 是 Markdown 正文。不要用 --- 当分隔线。',
    parameters: createConversationDocumentSchema,
    execute: async (_id, params) => {
      let contentJson: Record<string, unknown>;
      try {
        contentJson = markdownToContentJson(params.contentMd) as Record<string, unknown>;
      } catch (err) {
        const reason = err instanceof Error ? err.message : '正文无法写入';
        return toolResult(JSON.stringify({ ok: false, reason }), { ok: false, reason });
      }
      if (documentPlainText(contentJson).trim().length === 0) {
        return toolResult(JSON.stringify({ ok: false, reason: '正文是空的' }), { ok: false });
      }
      const title =
        params.title !== undefined && params.title.trim().length > 0
          ? plainClip(params.title, DOCUMENT_TITLE_MAX)
          : null;
      const [row] = await getDb()
        .insert(documents)
        .values({
          userId: session.userId,
          title,
          contentJson,
          source: 'editor',
          status: 'digested',
        })
        .returning({ id: documents.id, title: documents.title });
      if (!row) return toolResult(JSON.stringify({ ok: false, reason: '没能新建' }), { ok: false });
      await tryIndexOwnedDocument(session.userId, row.id);
      const savedTitle = displayTitle(row.title);
      session.actions.push({
        type: 'create_document',
        documentId: row.id,
        title: savedTitle,
      });
      return toolResult(
        JSON.stringify({ ok: true, documentId: row.id, title: savedTitle }),
        { ok: true, documentId: row.id },
      );
    },
  };
}

const conversationWriteCardsSchema = Type.Object({
  documentId: Type.String({ minLength: 1, maxLength: 36 }),
  cards: Type.Array(cardDraftSchema, { minItems: 1, maxItems: 3 }),
});

export function conversationWriteCardsTool(
  session: ConversationSession,
): AgentTool<typeof conversationWriteCardsSchema> {
  return {
    name: 'write_cards',
    label: '写入卡片',
    description:
      '仅当用户明确要求做成卡片时调用。把 1-3 张原子卡片写到指定文档上。每张卡要有概念、例子、易混点、标签，以及文档里的 blockIndex 和精确 quote。',
    parameters: conversationWriteCardsSchema,
    execute: async (toolCallId, params) => {
      if (!session.allowCards) {
        throw new Error('用户没有要求生成卡片');
      }
      const [row] = await getDb()
        .select({ id: documents.id, title: documents.title })
        .from(documents)
        .where(
          and(
            eq(documents.id, params.documentId),
            eq(documents.userId, session.userId),
            isNull(documents.deletedAt),
          ),
        )
        .limit(1);
      if (!row) throw new Error('找不到这篇文档');
      const base = writeCardsTool(digestSession(session, row.id));
      const result = await base.execute(toolCallId, { cards: params.cards });
      session.actions.push({
        type: 'write_cards',
        documentId: row.id,
        title: displayTitle(row.title),
        count: params.cards.length,
      });
      return result;
    },
  };
}

const mindNodeIdSchema = Type.Object({
  documentId: Type.String({ minLength: 36, maxLength: 36 }),
  nodeId: Type.String({ minLength: 36, maxLength: 36 }),
});

export function readMindNodeTool(session: ConversationSession): AgentTool<typeof mindNodeIdSchema> {
  return {
    name: 'read_mind_node',
    label: '读取脑图节点',
    description:
      '读取用户加入过对话的一个脑图节点，返回概念、笔记或文字。只能读已经加入的节点。图片没有可阅读的内容。',
    parameters: mindNodeIdSchema,
    execute: async (_id, params) => {
      if (!mindNodeAllowed(session.mindNodeKeys, params.documentId, params.nodeId)) {
        const reason = '这个节点没有加入对话';
        return toolResult(JSON.stringify({ ok: false, reason }), { ok: false, reason });
      }
      const [facts] = await loadMindNodeFacts(session.userId, [
        { documentId: params.documentId, nodeId: params.nodeId, kind: 'text', label: '节点' },
      ]);
      if (!facts || facts.missing) {
        const reason = '找不到这个节点';
        return toolResult(JSON.stringify({ ok: false, reason }), { ok: false, reason });
      }
      const text = formatMindNode(facts);
      return toolResult(JSON.stringify({ ok: true, text }), { ok: true, text });
    },
  };
}

const updateMindNodeSchema = Type.Object({
  documentId: Type.String({ minLength: 36, maxLength: 36 }),
  nodeId: Type.String({ minLength: 36, maxLength: 36 }),
  text: Type.String({ minLength: 1, maxLength: 20_000 }),
  detail: Type.Optional(Type.String({ maxLength: 4000 })),
});

export function updateMindNodeTool(
  session: ConversationSession,
): AgentTool<typeof updateMindNodeSchema> {
  return {
    name: 'update_mind_node',
    label: '修改脑图节点',
    description:
      '修改用户加入过对话的脑图节点。text 写入卡片概念、批注笔记或文本节点的文字。批注的引文不动。detail 只在用户要求改卡片例子时传入。不要改题目，不要删除节点，不要改没有加入对话的节点。图片节点会失败。',
    parameters: updateMindNodeSchema,
    execute: async (_id, params) => {
      const refuse = (reason: string, title = '节点') => {
        session.actions.push({
          type: 'update_mind_node',
          documentId: params.documentId,
          nodeId: params.nodeId,
          title,
          status: 'rejected',
          reason,
        });
        return toolResult(JSON.stringify({ ok: false, reason }), { ok: false, reason });
      };
      if (!mindNodeAllowed(session.mindNodeKeys, params.documentId, params.nodeId)) {
        return refuse('这个节点没有加入对话');
      }
      const [facts] = await loadMindNodeFacts(session.userId, [
        { documentId: params.documentId, nodeId: params.nodeId, kind: 'text', label: '节点' },
      ]);
      if (!facts || facts.missing) return refuse('找不到这个节点');
      if (facts.rejected) return refuse('这张卡已经丢弃，不能修改', facts.label);
      const plan = planMindNodeUpdate({
        kind: facts.kind,
        text: params.text,
        ...(params.detail !== undefined ? { detail: params.detail } : {}),
      });
      if (!plan.ok) return refuse(plan.reason, facts.label);
      const saved = await applyMindNodeUpdate(
        session.userId,
        { documentId: params.documentId, nodeId: params.nodeId },
        plan,
      );
      if (!saved.ok) return refuse(saved.reason, facts.label);
      session.actions.push({
        type: 'update_mind_node',
        documentId: params.documentId,
        nodeId: params.nodeId,
        title: saved.label,
        status: 'applied',
      });
      return toolResult(
        JSON.stringify({ ok: true, nodeId: params.nodeId, title: saved.label }),
        { ok: true, nodeId: params.nodeId },
      );
    },
  };
}

export function conversationTools(session: ConversationSession): AgentTool[] {
  const search = searchCardsTool(digestSession(session, session.userId));
  search.description = '检索用户已有卡片。回答前可以先查一次，避免把已经学过的内容再讲一遍。';
  return [
    ...memoryLoadTools(session),
    search,
    readConversationDocumentTool(session),
    findDocumentsTool(session),
    updateDocumentTool(session),
    createConversationDocumentTool(session),
    conversationWriteCardsTool(session),
    readMindNodeTool(session),
    updateMindNodeTool(session),
    readDocumentMindTool(session),
    applyMindEditsTool(session),
  ];
}
