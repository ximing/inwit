import { z } from 'zod';
import { cardWithQuestionsSchema } from './card.js';
import { paginationQuerySchema } from './common.js';

export const DOCUMENT_SOURCES = ['editor', 'paste', 'chat', 'agent'] as const;
export const documentSourceSchema = z.enum(DOCUMENT_SOURCES);
export type DocumentSource = z.infer<typeof documentSourceSchema>;

export const DOCUMENT_STATUSES = ['pending', 'digested', 'failed'] as const;
export const documentStatusSchema = z.enum(DOCUMENT_STATUSES);
export type DocumentStatus = z.infer<typeof documentStatusSchema>;

export const DOCUMENT_TITLE_MAX = 40;

export const WEEKLY_REPORT_TITLE_MARK = '学习复盘';
export const AGENT_DOC_LABEL_REPORT = 'AI 复盘';
export const AGENT_DOC_LABEL_CONTRAST = '对比专题';

/** List/detail badge for `source=agent` docs. Weekly recap vs contrast essay. */
export function agentDocumentMetaLabel(source: DocumentSource, title: string): string | null {
  if (source !== 'agent') return null;
  if (title.includes(WEEKLY_REPORT_TITLE_MARK)) return AGENT_DOC_LABEL_REPORT;
  return AGENT_DOC_LABEL_CONTRAST;
}

/** First non-empty line (ATX heading marks stripped), then at most 40 Unicode characters. */
export function titleFromContent(contentMd: string): string {
  const normalized = contentMd.replace(/\r\n/g, '\n');
  const firstLine = normalized.split('\n').find((line) => line.trim().length > 0) ?? normalized;
  const trimmed = firstLine.trim().replace(/^#{1,6}(?:\s+|$)/, '').trim();
  const chars = [...trimmed];
  if (chars.length === 0) return '未命名文档';
  return chars.slice(0, DOCUMENT_TITLE_MAX).join('');
}

export const documentSchema = z.object({
  id: z.string().uuid(),
  userId: z.string().uuid(),
  topicId: z.string().uuid().nullable(),
  mapNodeId: z.string().uuid().nullable(),
  title: z.string(),
  contentMd: z.string(),
  source: documentSourceSchema,
  status: documentStatusSchema,
  answer: z.string().nullable(),
  linkHint: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type Document = z.infer<typeof documentSchema>;

export const createDocumentInputSchema = z.object({
  title: z.string().trim().min(1).max(500).optional(),
  contentMd: z.string().trim().min(1).max(100_000),
  topicId: z.string().uuid().optional(),
  source: z.enum(['editor', 'paste']).optional(),
});
export type CreateDocumentInput = z.infer<typeof createDocumentInputSchema>;

export const updateDocumentInputSchema = z
  .object({
    title: z.string().trim().min(1).max(500).optional(),
    contentMd: z.string().max(100_000).optional(),
  })
  .refine((value) => value.title !== undefined || value.contentMd !== undefined, {
    message: 'title or contentMd required',
  });
export type UpdateDocumentInput = z.infer<typeof updateDocumentInputSchema>;

export const createChatInputSchema = z.object({
  question: z.string().trim().min(1).max(100_000),
  topicId: z.string().uuid().optional(),
});
export type CreateChatInput = z.infer<typeof createChatInputSchema>;

/** Trailing `?` / `？` (and whitespace) marks a composer-box question. */
export function isChatQuestion(text: string): boolean {
  return /[?？]\s*$/u.test(text.trim());
}

const emptyToUndef = (value: unknown) => (value === '' || value === undefined ? undefined : value);

export const listDocumentsQuerySchema = paginationQuerySchema.extend({
  topicId: z.preprocess(emptyToUndef, z.string().uuid().optional()),
  status: z.preprocess(emptyToUndef, documentStatusSchema.optional()),
});
export type ListDocumentsQuery = z.infer<typeof listDocumentsQuerySchema>;

export const documentListItemSchema = documentSchema.extend({
  cardCount: z.number().int().nonnegative(),
  topicTitle: z.string().nullable(),
});
export type DocumentListItem = z.infer<typeof documentListItemSchema>;

export const documentDetailSchema = documentSchema.extend({
  cards: z.array(cardWithQuestionsSchema),
  topicTitle: z.string().nullable(),
});
export type DocumentDetail = z.infer<typeof documentDetailSchema>;
