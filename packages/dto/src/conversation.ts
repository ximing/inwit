import { z } from 'zod';
import { canvasNodeKindSchema, type CanvasNodeKind } from './canvas.js';

export type ConversationNodeKind = CanvasNodeKind;

export const CONVERSATION_MENTION_MAX = 5;
export const CONVERSATION_NODE_MAX = 5;
export const CONVERSATION_TEXT_MAX = 20_000;
export const CONVERSATION_TITLE_MAX = 24;

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
  if (action.movedCount > 0) parts.push(`移动 ${String(action.movedCount)} 个节点`);
  if (action.deletedCount > 0) parts.push(`删除 ${String(action.deletedCount)} 个章节`);
  const detail = parts.length > 0 ? `：${parts.join('，')}` : '';
  return `已调整《${action.title}》的脑图${detail}`;
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
