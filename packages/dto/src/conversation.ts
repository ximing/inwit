import { z } from 'zod';
import { canvasNodeKindSchema, type CanvasNodeKind } from './canvas.js';

export type ConversationNodeKind = CanvasNodeKind;

export const CONVERSATION_MENTION_MAX = 5;
export const CONVERSATION_NODE_MAX = 5;
export const CONVERSATION_TEXT_MAX = 20_000;
export const CONVERSATION_TITLE_MAX = 24;
/** Highlight quote attached to one conversation turn. */
export const CONVERSATION_SELECTION_QUOTE_MAX = 8_000;

export const CONVERSATION_NODE_KIND_LABELS: Record<CanvasNodeKind, string> = {
  card: '卡片',
  annotation: '批注',
  text: '文本',
  image: '图片',
};

export const CONVERSATION_MESSAGE_ROLES = ['user', 'assistant'] as const;
export const conversationMessageRoleSchema = z.enum(CONVERSATION_MESSAGE_ROLES);
export type ConversationMessageRole = z.infer<typeof conversationMessageRoleSchema>;

export const CONVERSATION_MESSAGE_STATUSES = ['pending', 'done', 'failed'] as const;
export const conversationMessageStatusSchema = z.enum(CONVERSATION_MESSAGE_STATUSES);
export type ConversationMessageStatus = z.infer<typeof conversationMessageStatusSchema>;

export const conversationDocumentRefSchema = z.object({
  id: z.string().uuid(),
  title: z.string(),
});
export type ConversationDocumentRef = z.infer<typeof conversationDocumentRefSchema>;

/** A mind-map node the user attached to one conversation turn. */
export const conversationNodeRefSchema = z.object({
  documentId: z.string().uuid(),
  nodeId: z.string().uuid(),
  kind: canvasNodeKindSchema,
  label: z.string().trim().min(1).max(80),
});
export type ConversationNodeRef = z.infer<typeof conversationNodeRefSchema>;

/**
 * A passage the user highlighted when starting a turn.
 * `blockIndex` is 1-based in the article. `pageIndex` is the 0-based PDF page.
 * `from` / `to` are ProseMirror positions when the editor had them.
 */
export const conversationSelectionSchema = z.object({
  documentId: z.string().uuid(),
  quote: z.string().trim().min(1).max(CONVERSATION_SELECTION_QUOTE_MAX),
  blockIndex: z.number().int().positive().optional(),
  from: z.number().int().nonnegative().optional(),
  to: z.number().int().positive().optional(),
  pageIndex: z.number().int().nonnegative().optional(),
});
export type ConversationSelection = z.infer<typeof conversationSelectionSchema>;

export const conversationActionSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('update_document'),
    documentId: z.string().uuid(),
    title: z.string(),
    status: z.enum(['applied', 'blocked_dirty', 'rejected']),
    reason: z.string().optional(),
  }),
  z.object({
    type: z.literal('create_document'),
    documentId: z.string().uuid(),
    title: z.string(),
  }),
  z.object({
    type: z.literal('write_cards'),
    documentId: z.string().uuid(),
    title: z.string(),
    count: z.number().int().positive(),
  }),
  z.object({
    type: z.literal('update_mind_node'),
    documentId: z.string().uuid(),
    nodeId: z.string().uuid(),
    title: z.string(),
    status: z.enum(['applied', 'rejected']),
    reason: z.string().optional(),
  }),
  z.object({
    type: z.literal('apply_mind_edits'),
    documentId: z.string().uuid(),
    title: z.string(),
    status: z.enum(['applied', 'rejected']),
    reason: z.string().optional(),
    createdCount: z.number().int().nonnegative(),
    /** 本批新建的划线。旧记录没有这个字段，读出来按 0。 */
    highlightCount: z.number().int().nonnegative().default(0),
    renamedCount: z.number().int().nonnegative(),
    movedCount: z.number().int().nonnegative(),
    deletedCount: z.number().int().nonnegative(),
    /** 本批改了锚点的划线。旧记录没有这个字段，读出来按 0。 */
    retargetedCount: z.number().int().nonnegative().default(0),
  }),
  z.object({
    type: z.literal('adjust_topic'),
    topicId: z.string().uuid().nullable(),
    title: z.string(),
    status: z.enum(['applied', 'rejected']),
    reason: z.string().optional(),
    created: z.boolean().default(false),
    titleChanged: z.boolean().default(false),
    goalChanged: z.boolean().default(false),
    assignedCount: z.number().int().nonnegative().default(0),
    unassignedCount: z.number().int().nonnegative().default(0),
    createdNodeCount: z.number().int().nonnegative().default(0),
    renamedNodeCount: z.number().int().nonnegative().default(0),
    movedNodeCount: z.number().int().nonnegative().default(0),
    deletedNodeCount: z.number().int().nonnegative().default(0),
    placedDocumentCount: z.number().int().nonnegative().default(0),
    placedCardCount: z.number().int().nonnegative().default(0),
    clearedDocumentCount: z.number().int().nonnegative().default(0),
    clearedCardCount: z.number().int().nonnegative().default(0),
  }),
  /** 概念生成候选批次：只生成，不含确认权限；动作卡打开批次预览。 */
  z.object({
    type: z.literal('concept_batch'),
    documentId: z.string().uuid(),
    title: z.string(),
    topicId: z.string().uuid(),
    batchId: z.string().uuid(),
    jobId: z.string().uuid(),
    status: z.enum(['queued', 'rejected']),
    reason: z.string().optional(),
  }),
]);

/** 对话里展示的脑图调整结果。 */
export function mindEditSummary(action: {
  title: string;
  status: 'applied' | 'rejected';
  reason?: string | undefined;
  createdCount: number;
  highlightCount?: number;
  renamedCount: number;
  movedCount: number;
  deletedCount: number;
  retargetedCount?: number;
}): string {
  if (action.status !== 'applied') {
    const reason = action.reason?.trim() ?? '';
    return `没能调整《${action.title}》的脑图${reason ? `：${reason}` : ''}`;
  }
  const parts: string[] = [];
  const created: string[] = [];
  if (action.createdCount > 0) created.push(`${String(action.createdCount)} 个章节`);
  if ((action.highlightCount ?? 0) > 0) created.push(`${String(action.highlightCount)} 处划线`);
  if (created.length > 0) parts.push(`新建 ${created.join('、')}`);
  if (action.renamedCount > 0) parts.push(`改了 ${String(action.renamedCount)} 个章节标题`);
  if ((action.retargetedCount ?? 0) > 0) {
    parts.push(`改了 ${String(action.retargetedCount)} 处划线锚点`);
  }
  if (action.movedCount > 0) parts.push(`移动 ${String(action.movedCount)} 个节点`);
  if (action.deletedCount > 0) parts.push(`删除 ${String(action.deletedCount)} 个章节`);
  const detail = parts.length > 0 ? `：${parts.join('，')}` : '';
  return `已调整《${action.title}》的脑图${detail}`;
}

/** 对话里展示的主题调整结果。 */
export function topicAdjustSummary(action: {
  title: string;
  status: 'applied' | 'rejected';
  reason?: string | undefined;
  created?: boolean;
  titleChanged?: boolean;
  goalChanged?: boolean;
  assignedCount?: number;
  unassignedCount?: number;
  createdNodeCount?: number;
  renamedNodeCount?: number;
  movedNodeCount?: number;
  deletedNodeCount?: number;
  placedDocumentCount?: number;
  placedCardCount?: number;
  clearedDocumentCount?: number;
  clearedCardCount?: number;
}): string {
  const name = action.title.trim() || '主题';
  if (action.status !== 'applied') {
    const reason = action.reason?.trim() ?? '';
    return `没能调整主题「${name}」${reason ? `：${reason}` : ''}`;
  }
  const parts: string[] = [];
  if (action.titleChanged) parts.push('改了标题');
  if (action.goalChanged) parts.push('改了目标');
  const assigned = action.assignedCount ?? 0;
  const unassigned = action.unassignedCount ?? 0;
  const createdNodes = action.createdNodeCount ?? 0;
  const renamed = action.renamedNodeCount ?? 0;
  const moved = action.movedNodeCount ?? 0;
  const deleted = action.deletedNodeCount ?? 0;
  const placedDocs = action.placedDocumentCount ?? 0;
  const placedCards = action.placedCardCount ?? 0;
  const clearedDocs = action.clearedDocumentCount ?? 0;
  const clearedCards = action.clearedCardCount ?? 0;
  if (assigned > 0) parts.push(`归入 ${String(assigned)} 篇`);
  if (unassigned > 0) parts.push(`移出 ${String(unassigned)} 篇`);
  if (createdNodes > 0) parts.push(`新建 ${String(createdNodes)} 个节点`);
  if (renamed > 0) parts.push(`改了 ${String(renamed)} 个节点`);
  if (moved > 0) parts.push(`移动 ${String(moved)} 个节点`);
  if (deleted > 0) parts.push(`删除 ${String(deleted)} 个节点`);
  if (placedDocs > 0) parts.push(`挂上 ${String(placedDocs)} 篇资料`);
  if (placedCards > 0) parts.push(`挂上 ${String(placedCards)} 张卡片`);
  if (clearedDocs > 0) parts.push(`取下 ${String(clearedDocs)} 篇资料`);
  if (clearedCards > 0) parts.push(`取下 ${String(clearedCards)} 张卡片`);
  const detail = parts.length > 0 ? `：${parts.join('，')}` : '';
  if (action.created) return `已新建主题「${name}」${detail}`;
  return `已调整主题「${name}」${detail}`;
}

export type ConversationAction = z.infer<typeof conversationActionSchema>;

export const conversationSchema = z.object({
  id: z.string().uuid(),
  title: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type Conversation = z.infer<typeof conversationSchema>;

export const conversationMessageSchema = z.object({
  id: z.string().uuid(),
  conversationId: z.string().uuid(),
  role: conversationMessageRoleSchema,
  content: z.string(),
  /** Model reasoning shown beside the reply. Empty when the model did not think aloud. */
  thinking: z.string().default(''),
  /** Short status while the reply is still being written, such as 正在阅读文档. */
  activity: z.string().nullable().default(null),
  documents: z.array(conversationDocumentRefSchema),
  nodes: z.array(conversationNodeRefSchema).default([]),
  /** Passage highlighted for this turn. Null on assistant rows and older messages. */
  selection: conversationSelectionSchema.nullable().default(null),
  actions: z.array(conversationActionSchema),
  status: conversationMessageStatusSchema,
  failReason: z.string().nullable(),
  createdAt: z.string(),
});
export type ConversationMessage = z.infer<typeof conversationMessageSchema>;

export const conversationDetailSchema = conversationSchema.extend({
  messages: z.array(conversationMessageSchema),
});
export type ConversationDetail = z.infer<typeof conversationDetailSchema>;

export const conversationListSchema = z.object({
  items: z.array(conversationSchema),
});
export type ConversationList = z.infer<typeof conversationListSchema>;

export const listConversationsQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(50).default(30),
});
export type ListConversationsQuery = z.infer<typeof listConversationsQuerySchema>;

export const sendConversationInputSchema = z.object({
  text: z.string().trim().min(1).max(CONVERSATION_TEXT_MAX),
  documentIds: z.array(z.string().uuid()).max(CONVERSATION_MENTION_MAX).default([]),
  /** Mind-map nodes attached from the canvas. Omitted means none. */
  nodes: z.array(conversationNodeRefSchema).max(CONVERSATION_NODE_MAX).optional(),
  /** Article passage highlighted for this turn. Omitted means none. */
  selection: conversationSelectionSchema.optional(),
  dirtyDocumentIds: z.array(z.string().uuid()).max(8).default([]),
  /** Use this saved model for the turn. Omitted means the user's default. */
  llmConfigId: z.string().uuid().optional(),
});
export type SendConversationInput = z.infer<typeof sendConversationInputSchema>;

export const retryConversationInputSchema = z.object({
  dirtyDocumentIds: z.array(z.string().uuid()).max(8).default([]),
  llmConfigId: z.string().uuid().optional(),
});
export type RetryConversationInput = z.infer<typeof retryConversationInputSchema>;
