import { z } from 'zod';

export const CONVERSATION_MENTION_MAX = 5;
export const CONVERSATION_TEXT_MAX = 20_000;
export const CONVERSATION_TITLE_MAX = 24;

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
]);
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
  dirtyDocumentIds: z.array(z.string().uuid()).max(8).default([]),
});
export type SendConversationInput = z.infer<typeof sendConversationInputSchema>;

export const retryConversationInputSchema = z.object({
  dirtyDocumentIds: z.array(z.string().uuid()).max(8).default([]),
});
export type RetryConversationInput = z.infer<typeof retryConversationInputSchema>;
