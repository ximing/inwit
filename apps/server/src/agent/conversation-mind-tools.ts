import { Type } from '@earendil-works/pi-ai';
import type { AgentTool } from '@earendil-works/pi-agent-core';
import type { ConversationAction } from '@inwit/dto';
import { applyDocumentMindEdits, loadDocumentMind } from '../canvas/canvas.service.js';
import { formatDocumentMind, type MindEditInput } from '../canvas/mind-edit-logic.js';
import { AppError } from '../errors.js';

export interface MindToolSession {
  userId: string;
  mindDocumentIds: ReadonlySet<string>;
  actions: ConversationAction[];
}

function toolResult(text: string, details: unknown = null) {
  return { content: [{ type: 'text' as const, text }], details };
}

function displayTitle(title: string | null | undefined): string {
  const trimmed = title?.trim() ?? '';
  return trimmed.length > 0 ? trimmed : '未命名文档';
}

const documentIdSchema = Type.Object({
  documentId: Type.String({ minLength: 36, maxLength: 36 }),
});

const mindEditSchema = Type.Object({
  op: Type.Union([
    Type.Literal('create_text'),
    Type.Literal('create_highlight'),
    Type.Literal('rename_text'),
    Type.Literal('move'),
    Type.Literal('delete_text'),
    Type.Literal('retarget_highlight'),
  ]),
  ref: Type.Optional(Type.String({ maxLength: 40 })),
  nodeId: Type.Optional(Type.String({ maxLength: 40 })),
  text: Type.Optional(Type.String({ maxLength: 4000 })),
  blockIndex: Type.Optional(Type.Integer({ minimum: 1, maximum: 100_000 })),
  quote: Type.Optional(Type.String({ maxLength: 20_000 })),
  note: Type.Optional(Type.String({ maxLength: 20_000 })),
  parentId: Type.Optional(Type.Union([Type.String({ maxLength: 40 }), Type.Null()])),
  parentRef: Type.Optional(Type.String({ maxLength: 40 })),
  index: Type.Optional(Type.Integer({ minimum: 0, maximum: 500 })),
});

const applyMindEditsSchema = Type.Object({
  documentId: Type.String({ minLength: 36, maxLength: 36 }),
  edits: Type.Array(mindEditSchema, { minItems: 1, maxItems: 80 }),
});

function refuseMind(
  session: MindToolSession,
  documentId: string,
  title: string,
  reason: string,
) {
  session.actions.push({
    type: 'apply_mind_edits',
    documentId,
    title,
    status: 'rejected',
    reason,
    createdCount: 0,
    highlightCount: 0,
    renamedCount: 0,
    movedCount: 0,
    deletedCount: 0,
    retargetedCount: 0,
  });
  return toolResult(JSON.stringify({ ok: false, reason }), { ok: false, reason });
}

export function readDocumentMindTool(session: MindToolSession): AgentTool<typeof documentIdSchema> {
  return {
    name: 'read_document_mind',
    label: '读取文档脑图',
    description:
      '读取一篇文档的整棵脑图。每行是文本、卡片、批注或图片，带 id、标题和父节点。调整脑图前必须先调用。只能读本轮 @ 的文档，或本轮加入对话的节点所属的文档。',
    parameters: documentIdSchema,
    execute: async (_id, params) => {
      if (!session.mindDocumentIds.has(params.documentId)) {
        const reason = '这轮没有点名这篇文档';
        return toolResult(JSON.stringify({ ok: false, reason }), { ok: false, reason });
      }
      try {
        const mind = await loadDocumentMind(session.userId, params.documentId);
        const view = formatDocumentMind({
          documentId: params.documentId,
          title: displayTitle(mind.title),
          nodes: mind.nodes,
        });
        return toolResult(JSON.stringify({ ok: true, text: view.text, truncated: view.truncated }), {
          ok: true,
          truncated: view.truncated,
        });
      } catch (err) {
        const reason =
          err instanceof AppError && err.code === 'DOCUMENT_NOT_FOUND' ? '找不到这篇文档' : '没能读到脑图';
        return toolResult(JSON.stringify({ ok: false, reason }), { ok: false, reason });
      }
    },
  };
}

export function applyMindEditsTool(
  session: MindToolSession,
): AgentTool<typeof applyMindEditsSchema> {
  return {
    name: 'apply_mind_edits',
    label: '调整文档脑图',
    description:
      '按顺序调整一篇文档的脑图。同一批一起成功或一起失败。edits 里没点到的节点保持原样。只能改本轮点名的文档，且要先 read_document_mind。' +
      'create_text 新建文本章节，ref 用字母开头的临时编号，text 是标题。这种节点点不开原文。' +
      'create_highlight 新建能点回原文的划线。ref 同样是临时编号。blockIndex 是 read_document 输出里「[块 N | …]」的 N。quote 是这一块中连续的原文，必须逐字抄写，不能改写，不能跨块。note 可选，是脑图上显示的短标题。原文对不上时整批失败，原因是「第 N 块里找不到这句」。可以创建划线，不要声称只能由用户选中。PDF 框选划线不能用这个操作。前文里只是提到后一章的句子不能当那一章的引文。' +
      'retarget_highlight 改正已有划线的锚点。nodeId 用脑图里的 id，blockIndex 和 quote 的规则与新建相同。note 省略则保留原来的短标题。节点和父子关系不变。PDF 框选划线不能改。' +
      'parentRef 挂到本批更早的节点，parentId 挂到已有节点，都不写则在最外层。' +
      'rename_text 改已有文本的标题。move 移动已有节点，parentId 为 null 表示挂到最外层。delete_text 只删文本章节，子节点回到最外层，不删卡片和划线。' +
      'index 从 0 起，不写则接到末尾。最外层已有卡片时，新节点用 index 0、1、2 排在前面。用户只要标题大纲时只提交 create_text。用户要脉络能点回原文时用 create_highlight，不要改用 write_cards。用户要求把卡片归进脉络时，只 move 父节点为 - 的卡片。已经有父节点的、已有批注和图片，只有用户明确要求才动。不要用这个工具改卡片正文。成功后会记入这篇文档的脑图历史，用户可以自行恢复。',
    parameters: applyMindEditsSchema,
    execute: async (_id, params) => {
      if (!session.mindDocumentIds.has(params.documentId)) {
        return refuseMind(session, params.documentId, '文档', '这轮没有点名这篇文档');
      }
      let title = '文档';
      try {
        const mind = await loadDocumentMind(session.userId, params.documentId);
        title = displayTitle(mind.title);
      } catch (err) {
        const reason =
          err instanceof AppError && err.code === 'DOCUMENT_NOT_FOUND' ? '找不到这篇文档' : '没能读到脑图';
        return refuseMind(session, params.documentId, title, reason);
      }
      const edits: MindEditInput[] = params.edits.map((edit) => ({
        op: edit.op,
        ...(edit.ref !== undefined ? { ref: edit.ref } : {}),
        ...(edit.nodeId !== undefined ? { nodeId: edit.nodeId } : {}),
        ...(edit.text !== undefined ? { text: edit.text } : {}),
        ...(edit.blockIndex !== undefined ? { blockIndex: edit.blockIndex } : {}),
        ...(edit.quote !== undefined ? { quote: edit.quote } : {}),
        ...(edit.note !== undefined ? { note: edit.note } : {}),
        ...(edit.parentId !== undefined ? { parentId: edit.parentId } : {}),
        ...(edit.parentRef !== undefined ? { parentRef: edit.parentRef } : {}),
        ...(edit.index !== undefined ? { index: edit.index } : {}),
      }));
      const saved = await applyDocumentMindEdits(session.userId, params.documentId, edits);
      if (!saved.ok) return refuseMind(session, params.documentId, title, saved.reason);
      session.actions.push({
        type: 'apply_mind_edits',
        documentId: params.documentId,
        title,
        status: 'applied',
        createdCount: saved.createdCount,
        highlightCount: saved.highlightCount,
        renamedCount: saved.renamedCount,
        movedCount: saved.movedCount,
        deletedCount: saved.deletedCount,
        retargetedCount: saved.retargetedCount,
      });
      const payload = {
        ok: true,
        documentId: params.documentId,
        created: saved.created,
        createdCount: saved.createdCount,
        highlightCount: saved.highlightCount,
        renamedCount: saved.renamedCount,
        movedCount: saved.movedCount,
        deletedCount: saved.deletedCount,
        retargetedCount: saved.retargetedCount,
      };
      return toolResult(JSON.stringify(payload), payload);
    },
  };
}
