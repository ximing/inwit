import { Type } from '@earendil-works/pi-ai';
import type { AgentTool } from '@earendil-works/pi-agent-core';
import type { ConversationAction } from '@inwit/dto';
import { and, desc, eq, ilike, isNull } from 'drizzle-orm';
import { setCardMapNode } from '../cards/card.service.js';
import { getDb } from '../db/index.js';
import { cards, documents, topics } from '../db/schema.js';
import { setDocumentMapNode, updateDocument } from '../documents/document.service.js';
import { AppError } from '../errors.js';
import {
  createMapNode,
  deleteMapNode,
  getOwnedMapNode,
  getTopicMapFlat,
  updateMapNode,
} from '../maps/map.service.js';
import { createTopic, getTopic, updateTopic } from '../topics/topic.service.js';
import { clipReason } from './conversation-logic.js';
import {
  TOPIC_EDIT_MAX,
  planTopicEdits,
  type PlannedTopicEdit,
  type TopicEditDraft,
} from './conversation-topic-logic.js';

export interface TopicToolSession {
  userId: string;
  actions: ConversationAction[];
}

const LIST_CAP = 40;
const DOC_CAP = 40;
const CARD_CAP = 40;
const NODE_CAP = 80;

function toolResult(text: string, details: unknown = null) {
  return { content: [{ type: 'text' as const, text }], details };
}

function displayTitle(title: string | null | undefined, fallback: string): string {
  const trimmed = title?.trim() ?? '';
  return trimmed.length > 0 ? trimmed : fallback;
}

function clipText(text: string, max: number): string {
  const chars = [...text.trim()];
  if (chars.length <= max) return chars.join('');
  return `${chars.slice(0, max).join('')}…`;
}

function reasonOf(err: unknown): string {
  if (err instanceof AppError) return err.message;
  if (err instanceof Error && err.message.trim().length > 0) return err.message;
  return '这一步没有完成';
}

function refId(refs: ReadonlyMap<string, string>, ref: string): string {
  const id = refs.get(ref);
  if (!id) throw new Error('这一批里还没有这个编号');
  return id;
}

interface TopicBucket {
  topicId: string | null;
  title: string;
  created: boolean;
  titleChanged: boolean;
  goalChanged: boolean;
  assignedCount: number;
  unassignedCount: number;
  createdNodeCount: number;
  renamedNodeCount: number;
  movedNodeCount: number;
  deletedNodeCount: number;
  placedDocumentCount: number;
  placedCardCount: number;
  clearedDocumentCount: number;
  clearedCardCount: number;
}

function emptyBucket(topicId: string | null, title: string): TopicBucket {
  return {
    topicId,
    title,
    created: false,
    titleChanged: false,
    goalChanged: false,
    assignedCount: 0,
    unassignedCount: 0,
    createdNodeCount: 0,
    renamedNodeCount: 0,
    movedNodeCount: 0,
    deletedNodeCount: 0,
    placedDocumentCount: 0,
    placedCardCount: 0,
    clearedDocumentCount: 0,
    clearedCardCount: 0,
  };
}

function bucketChanged(bucket: TopicBucket): boolean {
  return (
    bucket.created ||
    bucket.titleChanged ||
    bucket.goalChanged ||
    bucket.assignedCount > 0 ||
    bucket.unassignedCount > 0 ||
    bucket.createdNodeCount > 0 ||
    bucket.renamedNodeCount > 0 ||
    bucket.movedNodeCount > 0 ||
    bucket.deletedNodeCount > 0 ||
    bucket.placedDocumentCount > 0 ||
    bucket.placedCardCount > 0 ||
    bucket.clearedDocumentCount > 0 ||
    bucket.clearedCardCount > 0
  );
}

class TopicLedger {
  private readonly titles = new Map<string, string>();
  private readonly buckets = new Map<string, TopicBucket>();

  remember(id: string, title: string): void {
    this.titles.set(id, title);
    const bucket = this.buckets.get(id);
    if (bucket) bucket.title = title;
  }

  titleOf(id: string | null): string | undefined {
    if (!id) return undefined;
    return this.titles.get(id);
  }

  bucket(id: string | null): TopicBucket {
    const key = id ?? '';
    const existing = this.buckets.get(key);
    if (existing) return existing;
    const title = id ? (this.titles.get(id) ?? '主题') : '未归属';
    const created = emptyBucket(id, title);
    this.buckets.set(key, created);
    return created;
  }

  async prepare(userId: string, topicId: string): Promise<TopicBucket> {
    const topic = await getTopic(userId, topicId);
    this.remember(topic.id, topic.title);
    if (topic.status !== 'active') throw AppError.of(409, 'TOPIC_ARCHIVED');
    return this.bucket(topic.id);
  }

  appliedActions(): ConversationAction[] {
    const actions: ConversationAction[] = [];
    for (const bucket of this.buckets.values()) {
      if (!bucketChanged(bucket)) continue;
      actions.push({
        type: 'adjust_topic',
        topicId: bucket.topicId,
        title: bucket.title,
        status: 'applied',
        created: bucket.created,
        titleChanged: bucket.titleChanged,
        goalChanged: bucket.goalChanged,
        assignedCount: bucket.assignedCount,
        unassignedCount: bucket.unassignedCount,
        createdNodeCount: bucket.createdNodeCount,
        renamedNodeCount: bucket.renamedNodeCount,
        movedNodeCount: bucket.movedNodeCount,
        deletedNodeCount: bucket.deletedNodeCount,
        placedDocumentCount: bucket.placedDocumentCount,
        placedCardCount: bucket.placedCardCount,
        clearedDocumentCount: bucket.clearedDocumentCount,
        clearedCardCount: bucket.clearedCardCount,
      });
    }
    return actions;
  }
}

function rejectedAction(topicId: string | null, title: string, reason: string): ConversationAction {
  return {
    type: 'adjust_topic',
    topicId,
    title,
    status: 'rejected',
    reason: clipReason(reason),
    created: false,
    titleChanged: false,
    goalChanged: false,
    assignedCount: 0,
    unassignedCount: 0,
    createdNodeCount: 0,
    renamedNodeCount: 0,
    movedNodeCount: 0,
    deletedNodeCount: 0,
    placedDocumentCount: 0,
    placedCardCount: 0,
    clearedDocumentCount: 0,
    clearedCardCount: 0,
  };
}

async function loadOwnedDocument(userId: string, documentId: string) {
  const [row] = await getDb()
    .select({
      id: documents.id,
      title: documents.title,
      topicId: documents.topicId,
      mapNodeId: documents.mapNodeId,
    })
    .from(documents)
    .where(and(eq(documents.id, documentId), eq(documents.userId, userId), isNull(documents.deletedAt)))
    .limit(1);
  if (!row) throw AppError.of(404, 'DOCUMENT_NOT_FOUND');
  return row;
}

async function loadOwnedCard(userId: string, cardId: string) {
  const [row] = await getDb()
    .select({
      id: cards.id,
      topicId: cards.topicId,
      mapNodeId: cards.mapNodeId,
    })
    .from(cards)
    .where(and(eq(cards.id, cardId), eq(cards.userId, userId), isNull(cards.deletedAt)))
    .limit(1);
  if (!row) throw AppError.of(404, 'CARD_NOT_FOUND');
  return row;
}

const listTopicsSchema = Type.Object({
  query: Type.Optional(Type.String({ maxLength: 80 })),
});

export function listTopicsTool(session: TopicToolSession): AgentTool<typeof listTopicsSchema> {
  return {
    name: 'list_topics',
    label: '查找主题',
    description:
      '按标题查找用户的活跃主题，返回 id、标题和目标。query 为空时返回最近更新的主题。归档主题不会出现。还不知道主题 id 时先调用这个。',
    parameters: listTopicsSchema,
    execute: async (_id, params) => {
      const needle = (params.query ?? '').replace(/[%_\\]/g, '').trim();
      const conditions = [eq(topics.userId, session.userId), eq(topics.status, 'active')];
      if (needle) conditions.push(ilike(topics.title, `%${needle}%`));
      const rows = await getDb()
        .select({ id: topics.id, title: topics.title, goal: topics.goal })
        .from(topics)
        .where(and(...conditions))
        .orderBy(desc(topics.updatedAt), desc(topics.id))
        .limit(LIST_CAP);
      const payload = rows.map((row) => ({
        id: row.id,
        title: row.title,
        goal: row.goal ? clipText(row.goal, 120) : null,
      }));
      return toolResult(JSON.stringify(payload), payload);
    },
  };
}

const readTopicSchema = Type.Object({
  topicId: Type.String({ minLength: 36, maxLength: 36 }),
});

export function readTopicTool(session: TopicToolSession): AgentTool<typeof readTopicSchema> {
  return {
    name: 'read_topic',
    label: '读取主题',
    description:
      '读取一个主题的目标、知识地图、资料和卡片。调整归属或地图前必须先调用。节点带 id、parentId、路径和标题。资料和卡片带 id 与 mapNodeId，没挂上地图时 mapNodeId 为 null。一次最多 40 篇资料、40 张卡片、80 个节点。',
    parameters: readTopicSchema,
    execute: async (_id, params) => {
      try {
        const topic = await getTopic(session.userId, params.topicId);
        const flat = await getTopicMapFlat(session.userId, params.topicId);
        const docRows = await getDb()
          .select({
            id: documents.id,
            title: documents.title,
            mapNodeId: documents.mapNodeId,
          })
          .from(documents)
          .where(
            and(
              eq(documents.userId, session.userId),
              eq(documents.topicId, params.topicId),
              isNull(documents.deletedAt),
            ),
          )
          .orderBy(desc(documents.updatedAt), desc(documents.id))
          .limit(DOC_CAP + 1);
        const cardRows = await getDb()
          .select({
            id: cards.id,
            concept: cards.concept,
            documentId: cards.documentId,
            mapNodeId: cards.mapNodeId,
          })
          .from(cards)
          .where(
            and(
              eq(cards.userId, session.userId),
              eq(cards.topicId, params.topicId),
              isNull(cards.deletedAt),
            ),
          )
          .orderBy(desc(cards.updatedAt), desc(cards.id))
          .limit(CARD_CAP + 1);
        const payload = {
          ok: true,
          id: topic.id,
          title: topic.title,
          goal: topic.goal,
          status: topic.status,
          nodes: flat.slice(0, NODE_CAP).map((node) => ({
            id: node.id,
            parentId: node.parentId,
            title: node.title,
            path: node.path,
            depth: node.depth,
            note: node.note ? clipText(node.note, 400) : null,
            cardCount: node.cardCount,
            docCount: node.docCount,
          })),
          nodesTruncated: flat.length > NODE_CAP,
          documents: docRows.slice(0, DOC_CAP).map((row) => ({
            id: row.id,
            title: displayTitle(row.title, '未命名文档'),
            mapNodeId: row.mapNodeId,
          })),
          documentsTruncated: docRows.length > DOC_CAP,
          cards: cardRows.slice(0, CARD_CAP).map((row) => ({
            id: row.id,
            concept: clipText(row.concept, 80),
            documentId: row.documentId,
            mapNodeId: row.mapNodeId,
          })),
          cardsTruncated: cardRows.length > CARD_CAP,
        };
        return toolResult(JSON.stringify(payload), {
          ok: true,
          nodesTruncated: payload.nodesTruncated,
          documentsTruncated: payload.documentsTruncated,
          cardsTruncated: payload.cardsTruncated,
        });
      } catch (err) {
        const reason =
          err instanceof AppError && err.code === 'TOPIC_NOT_FOUND' ? '找不到这个主题' : reasonOf(err);
        return toolResult(JSON.stringify({ ok: false, reason }), { ok: false, reason });
      }
    },
  };
}

const topicEditSchema = Type.Object({
  op: Type.Union([
    Type.Literal('create_topic'),
    Type.Literal('update_topic'),
    Type.Literal('assign_document'),
    Type.Literal('create_node'),
    Type.Literal('rename_node'),
    Type.Literal('move_node'),
    Type.Literal('delete_node'),
    Type.Literal('place_document'),
    Type.Literal('place_card'),
  ]),
  ref: Type.Optional(Type.String({ maxLength: 40 })),
  topicId: Type.Optional(Type.Union([Type.String({ maxLength: 36 }), Type.Null()])),
  topicRef: Type.Optional(Type.String({ maxLength: 40 })),
  documentId: Type.Optional(Type.String({ maxLength: 36 })),
  cardId: Type.Optional(Type.String({ maxLength: 36 })),
  nodeId: Type.Optional(Type.Union([Type.String({ maxLength: 36 }), Type.Null()])),
  nodeRef: Type.Optional(Type.String({ maxLength: 40 })),
  parentId: Type.Optional(Type.Union([Type.String({ maxLength: 36 }), Type.Null()])),
  parentRef: Type.Optional(Type.String({ maxLength: 40 })),
  title: Type.Optional(Type.String({ maxLength: 200 })),
  goal: Type.Optional(Type.Union([Type.String({ maxLength: 4000 }), Type.Null()])),
  note: Type.Optional(Type.Union([Type.String({ maxLength: 4000 }), Type.Null()])),
});

const adjustTopicSchema = Type.Object({
  edits: Type.Array(topicEditSchema, { minItems: 1, maxItems: TOPIC_EDIT_MAX }),
});

interface StepNote {
  op: string;
  unchanged?: boolean;
  id?: string;
  topicId?: string | null;
  documentId?: string;
  cardId?: string;
  nodeId?: string | null;
}

export function adjustTopicTool(session: TopicToolSession): AgentTool<typeof adjustTopicSchema> {
  return {
    name: 'adjust_topic',
    label: '调整主题',
    description:
      '用户明确要求时，按顺序调整主题。可以新建主题、改标题和目标、改文档归属、调整知识地图。不要删除或归档主题，不要改复习计划或设置。' +
      `一次最多 ${String(TOPIC_EDIT_MAX)} 步。某一步失败时，前面已经完成的会留下，后面不再执行。` +
      'create_topic：ref 是字母开头的临时编号，title 必填，goal 可选。' +
      'update_topic：topicId，title 和 goal 至少写一个。goal 为 null 表示清掉目标。' +
      'assign_document：把一篇文档归入主题。topicId 或 topicRef 二选一。topicId 为 null 表示移出主题。文档上的卡片会跟着走，并离开原来的地图节点。' +
      'create_node：ref、title，topicId 或 topicRef。parentRef 挂到本批更早的节点，parentId 挂到已有节点，都不写则在最外层。地图最多三级。' +
      'rename_node：nodeId，title 或 note。note 为 null 表示清掉笔记。' +
      'move_node：nodeId，parentId 或 parentRef。parentId 为 null 表示挂到最外层。' +
      'delete_node：删掉这个节点和下级节点。卡片和资料还在主题里，只是不再挂在节点上。只有用户明确要求删除时才用。' +
      'place_document 和 place_card：挂到 nodeId 或 nodeRef。nodeId 为 null 表示从节点上取下，但仍留在主题里。' +
      '资料若还没有主题，place_document 会先归入节点所在主题，文档上的卡片跟着走。卡片若还没有主题，place_card 只把这张卡归入该主题，文档不会跟着走。属于别的主题时先 assign_document。' +
      '先读再改。没点名的主题、文档和节点不要写进 edits。',
    parameters: adjustTopicSchema,
    execute: async (_id, params) => {
      const drafts: TopicEditDraft[] = params.edits.map((edit) => ({
        op: edit.op,
        ...(edit.ref !== undefined ? { ref: edit.ref } : {}),
        ...(edit.topicId !== undefined ? { topicId: edit.topicId } : {}),
        ...(edit.topicRef !== undefined ? { topicRef: edit.topicRef } : {}),
        ...(edit.documentId !== undefined ? { documentId: edit.documentId } : {}),
        ...(edit.cardId !== undefined ? { cardId: edit.cardId } : {}),
        ...(edit.nodeId !== undefined ? { nodeId: edit.nodeId } : {}),
        ...(edit.nodeRef !== undefined ? { nodeRef: edit.nodeRef } : {}),
        ...(edit.parentId !== undefined ? { parentId: edit.parentId } : {}),
        ...(edit.parentRef !== undefined ? { parentRef: edit.parentRef } : {}),
        ...(edit.title !== undefined ? { title: edit.title } : {}),
        ...(edit.goal !== undefined ? { goal: edit.goal } : {}),
        ...(edit.note !== undefined ? { note: edit.note } : {}),
      }));
      const plan = planTopicEdits(drafts);
      if (!plan.ok) {
        session.actions.push(rejectedAction(null, '这一步', plan.reason));
        return toolResult(JSON.stringify({ ok: false, reason: plan.reason }), {
          ok: false,
          reason: plan.reason,
        });
      }
      const ledger = new TopicLedger();
      const topicRefs = new Map<string, string>();
      const nodeRefs = new Map<string, string>();
      const steps: StepNote[] = [];
      const ids: { ref: string; id: string; kind: 'topic' | 'node' }[] = [];
      let focus: { topicId: string | null; title: string } = { topicId: null, title: '这一步' };
      try {
        for (let index = 0; index < plan.edits.length; index += 1) {
          focus = { topicId: null, title: '这一步' };
          const note = await applyTopicEdit({
            userId: session.userId,
            edit: plan.edits[index]!,
            ledger,
            topicRefs,
            nodeRefs,
            ids,
            focus,
          });
          steps.push(note);
        }
      } catch (err) {
        const reason = `第 ${String(steps.length + 1)} 步：${reasonOf(err)}`;
        const applied = ledger.appliedActions();
        for (const action of applied) session.actions.push(action);
        const title = ledger.titleOf(focus.topicId) ?? focus.title;
        session.actions.push(rejectedAction(focus.topicId, title, reason));
        const payload = { ok: false, reason, completed: steps.length, applied, steps, ids };
        return toolResult(JSON.stringify(payload), payload);
      }
      for (const action of ledger.appliedActions()) session.actions.push(action);
      const payload = { ok: true, completed: steps.length, steps, ids };
      return toolResult(JSON.stringify(payload), payload);
    },
  };
}

async function applyTopicEdit(input: {
  userId: string;
  edit: PlannedTopicEdit;
  ledger: TopicLedger;
  topicRefs: Map<string, string>;
  nodeRefs: Map<string, string>;
  ids: { ref: string; id: string; kind: 'topic' | 'node' }[];
  focus: { topicId: string | null; title: string };
}): Promise<StepNote> {
  const { userId, edit, ledger, topicRefs, nodeRefs, ids, focus } = input;
  switch (edit.op) {
    case 'create_topic': {
      focus.title = edit.title;
      const created = await createTopic(userId, {
        title: edit.title,
        ...(edit.goal !== undefined ? { goal: edit.goal } : {}),
      });
      ledger.remember(created.id, created.title);
      ledger.bucket(created.id).created = true;
      topicRefs.set(edit.ref, created.id);
      ids.push({ ref: edit.ref, id: created.id, kind: 'topic' });
      focus.topicId = created.id;
      focus.title = created.title;
      return { op: edit.op, id: created.id, topicId: created.id };
    }
    case 'update_topic': {
      focus.topicId = edit.topicId;
      const topic = await getTopic(userId, edit.topicId);
      ledger.remember(topic.id, topic.title);
      focus.title = topic.title;
      if (topic.status !== 'active') throw AppError.of(409, 'TOPIC_ARCHIVED');
      const patch: { title?: string; goal?: string | null } = {};
      if (edit.title !== undefined && edit.title !== topic.title) patch.title = edit.title;
      if (edit.goal !== undefined && edit.goal !== topic.goal) patch.goal = edit.goal;
      if (patch.title === undefined && patch.goal === undefined) {
        return { op: edit.op, unchanged: true, topicId: topic.id };
      }
      const updated = await updateTopic(userId, topic.id, patch);
      ledger.remember(updated.id, updated.title);
      const bucket = ledger.bucket(updated.id);
      if (patch.title !== undefined) bucket.titleChanged = true;
      if (patch.goal !== undefined) bucket.goalChanged = true;
      focus.title = updated.title;
      return { op: edit.op, topicId: updated.id };
    }
    case 'assign_document': {
      const topicId = edit.topicRef ? refId(topicRefs, edit.topicRef) : edit.topicId;
      focus.topicId = topicId;
      focus.title = topicId ? (ledger.titleOf(topicId) ?? '这一步') : '未归属';
      if (topicId) {
        const topic = await getTopic(userId, topicId);
        ledger.remember(topic.id, topic.title);
        focus.title = topic.title;
        if (topic.status !== 'active') throw AppError.of(409, 'TOPIC_ARCHIVED');
      }
      const doc = await loadOwnedDocument(userId, edit.documentId);
      if (doc.topicId === topicId) {
        return { op: edit.op, unchanged: true, documentId: doc.id, topicId };
      }
      if (doc.topicId) {
        const previous = await getTopic(userId, doc.topicId);
        ledger.remember(previous.id, previous.title);
      }
      await updateDocument(userId, doc.id, { topicId });
      if (doc.topicId) ledger.bucket(doc.topicId).unassignedCount += 1;
      if (topicId) ledger.bucket(topicId).assignedCount += 1;
      return { op: edit.op, documentId: doc.id, topicId };
    }
    case 'create_node': {
      const topicId = edit.topicRef ? refId(topicRefs, edit.topicRef) : edit.topicId;
      if (!topicId) throw new Error('新节点没有主题');
      focus.topicId = topicId;
      await ledger.prepare(userId, topicId);
      focus.title = ledger.titleOf(topicId) ?? '这一步';
      const parentId = edit.parentRef ? refId(nodeRefs, edit.parentRef) : edit.parentId;
      const created = await createMapNode(userId, topicId, {
        title: edit.title,
        ...(parentId ? { parentId } : {}),
        ...(edit.note !== undefined ? { note: edit.note } : {}),
      });
      nodeRefs.set(edit.ref, created.id);
      ids.push({ ref: edit.ref, id: created.id, kind: 'node' });
      ledger.bucket(topicId).createdNodeCount += 1;
      return { op: edit.op, id: created.id, topicId, nodeId: created.id };
    }
    case 'rename_node': {
      const node = await getOwnedMapNode(userId, edit.nodeId);
      focus.topicId = node.topicId;
      await ledger.prepare(userId, node.topicId);
      focus.title = ledger.titleOf(node.topicId) ?? '这一步';
      const patch: { title?: string; note?: string | null } = {};
      if (edit.title !== undefined && edit.title !== node.title) patch.title = edit.title;
      if (edit.note !== undefined && edit.note !== node.note) patch.note = edit.note;
      if (patch.title === undefined && patch.note === undefined) {
        return { op: edit.op, unchanged: true, nodeId: node.id, topicId: node.topicId };
      }
      await updateMapNode(userId, node.id, patch);
      ledger.bucket(node.topicId).renamedNodeCount += 1;
      return { op: edit.op, nodeId: node.id, topicId: node.topicId };
    }
    case 'move_node': {
      const node = await getOwnedMapNode(userId, edit.nodeId);
      focus.topicId = node.topicId;
      await ledger.prepare(userId, node.topicId);
      focus.title = ledger.titleOf(node.topicId) ?? '这一步';
      const parentId = edit.parentRef ? refId(nodeRefs, edit.parentRef) : edit.parentId;
      if (parentId === node.parentId) {
        return { op: edit.op, unchanged: true, nodeId: node.id, topicId: node.topicId };
      }
      await updateMapNode(userId, node.id, { parentId });
      ledger.bucket(node.topicId).movedNodeCount += 1;
      return { op: edit.op, nodeId: node.id, topicId: node.topicId };
    }
    case 'delete_node': {
      const node = await getOwnedMapNode(userId, edit.nodeId);
      focus.topicId = node.topicId;
      await ledger.prepare(userId, node.topicId);
      focus.title = ledger.titleOf(node.topicId) ?? '这一步';
      await deleteMapNode(userId, node.id);
      ledger.bucket(node.topicId).deletedNodeCount += 1;
      return { op: edit.op, nodeId: node.id, topicId: node.topicId };
    }
    case 'place_document': {
      const nodeId = edit.nodeRef ? refId(nodeRefs, edit.nodeRef) : edit.nodeId;
      const doc = await loadOwnedDocument(userId, edit.documentId);
      if (nodeId) {
        const node = await getOwnedMapNode(userId, nodeId);
        focus.topicId = node.topicId;
        await ledger.prepare(userId, node.topicId);
        focus.title = ledger.titleOf(node.topicId) ?? '这一步';
        if (doc.topicId !== null && doc.topicId !== node.topicId) {
          throw AppError.of(409, 'MAP_NODE_TOPIC_MISMATCH');
        }
        let joined = false;
        if (doc.topicId === null) {
          await updateDocument(userId, doc.id, { topicId: node.topicId });
          ledger.bucket(node.topicId).assignedCount += 1;
          joined = true;
        }
        if (!joined && doc.mapNodeId === nodeId) {
          return { op: edit.op, unchanged: true, documentId: doc.id, topicId: node.topicId };
        }
        await setDocumentMapNode(userId, doc.id, nodeId);
        ledger.bucket(node.topicId).placedDocumentCount += 1;
        return { op: edit.op, documentId: doc.id, topicId: node.topicId, nodeId };
      }
      focus.topicId = doc.topicId;
      if (doc.topicId) {
        const topic = await getTopic(userId, doc.topicId);
        ledger.remember(topic.id, topic.title);
        focus.title = topic.title;
      }
      if (doc.mapNodeId === null) {
        return { op: edit.op, unchanged: true, documentId: doc.id, topicId: doc.topicId, nodeId: null };
      }
      await setDocumentMapNode(userId, doc.id, null);
      if (doc.topicId) ledger.bucket(doc.topicId).clearedDocumentCount += 1;
      return { op: edit.op, documentId: doc.id, topicId: doc.topicId, nodeId: null };
    }
    case 'place_card': {
      const nodeId = edit.nodeRef ? refId(nodeRefs, edit.nodeRef) : edit.nodeId;
      const card = await loadOwnedCard(userId, edit.cardId);
      if (nodeId) {
        const node = await getOwnedMapNode(userId, nodeId);
        focus.topicId = node.topicId;
        await ledger.prepare(userId, node.topicId);
        focus.title = ledger.titleOf(node.topicId) ?? '这一步';
        if (card.topicId !== null && card.topicId !== node.topicId) {
          throw AppError.of(409, 'MAP_NODE_TOPIC_MISMATCH');
        }
        if (card.mapNodeId === nodeId && card.topicId === node.topicId) {
          return { op: edit.op, unchanged: true, cardId: card.id, topicId: node.topicId };
        }
        await setCardMapNode(userId, card.id, nodeId);
        ledger.bucket(node.topicId).placedCardCount += 1;
        return { op: edit.op, cardId: card.id, topicId: node.topicId, nodeId };
      }
      focus.topicId = card.topicId;
      if (card.topicId) {
        const topic = await getTopic(userId, card.topicId);
        ledger.remember(topic.id, topic.title);
        focus.title = topic.title;
      }
      if (card.mapNodeId === null) {
        return { op: edit.op, unchanged: true, cardId: card.id, topicId: card.topicId, nodeId: null };
      }
      await setCardMapNode(userId, card.id, null);
      if (card.topicId) ledger.bucket(card.topicId).clearedCardCount += 1;
      return { op: edit.op, cardId: card.id, topicId: card.topicId, nodeId: null };
    }
    default: {
      const _never: never = edit;
      throw new Error(`不认识这个操作 ${String(_never)}`);
    }
  }
}

export function conversationTopicTools(session: TopicToolSession): AgentTool[] {
  return [listTopicsTool(session), readTopicTool(session), adjustTopicTool(session)];
}
