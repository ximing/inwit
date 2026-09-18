import { blocksFromPmJSON, type PmJson } from '@inwit/doc-schema';
import { z } from 'zod';
import { cardReviewSummarySchema, cardWithQuestionsSchema } from './card.js';
import { paginationQuerySchema } from './common.js';

export const DOCUMENT_SOURCES = [
  'editor',
  'paste',
  'chat',
  'agent',
  'import',
  'screenshot',
  'api',
] as const;
export const documentSourceSchema = z.enum(DOCUMENT_SOURCES);
export type DocumentSource = z.infer<typeof documentSourceSchema>;

export const DOCUMENT_STATUSES = ['pending', 'digested', 'failed'] as const;
export const documentStatusSchema = z.enum(DOCUMENT_STATUSES);
export type DocumentStatus = z.infer<typeof documentStatusSchema>;

export const DOCUMENT_TITLE_MAX = 40;
export const UNNAMED_DOCUMENT_TITLE = '未命名文档';

export const WEEKLY_REPORT_TITLE_MARK = '学习复盘';
export const AGENT_DOC_LABEL_REPORT = 'AI 复盘';
export const AGENT_DOC_LABEL_CONTRAST = '对比专题';

/** Loose PM doc: enough to round-trip JSON, not a structural validator. */
export const pmDocSchema = z.object({ type: z.literal('doc') }).passthrough();
export type PmDocJson = z.infer<typeof pmDocSchema>;

export const EMPTY_PM_DOC = {
  type: 'doc' as const,
  content: [{ type: 'paragraph' }],
};

export const IMPORT_FORMATS = ['pdf', 'docx', 'epub', 'txt', 'md'] as const;
export type ImportFormat = (typeof IMPORT_FORMATS)[number];

export const FORMAT_BY_EXT: Record<string, ImportFormat> = {
  pdf: 'pdf',
  docx: 'docx',
  epub: 'epub',
  txt: 'txt',
  md: 'md',
};

export const FORMAT_BY_MIME: Record<string, ImportFormat> = {
  'application/pdf': 'pdf',
  'application/x-pdf': 'pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
  'application/epub+zip': 'epub',
  'application/epub': 'epub',
  'text/plain': 'txt',
  'text/markdown': 'md',
  'text/x-markdown': 'md',
};

export const MIME_BY_FORMAT: Record<ImportFormat, string> = {
  pdf: 'application/pdf',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  epub: 'application/epub+zip',
  txt: 'text/plain',
  md: 'text/markdown',
};

/** S3 multipart minimum part size (except the last part). */
export const MULTIPART_PART_SIZE = 5 * 1024 * 1024;

/** List/detail badge for `source=agent` docs. Weekly recap vs contrast essay. */
export function agentDocumentMetaLabel(
  source: DocumentSource,
  title: string | null | undefined,
  kind?: 'document' | 'weekly_report',
): string | null {
  if (source !== 'agent') return null;
  if (kind === 'weekly_report' || (kind === undefined && title?.includes(WEEKLY_REPORT_TITLE_MARK))) return AGENT_DOC_LABEL_REPORT;
  return AGENT_DOC_LABEL_CONTRAST;
}

function firstNonEmptyLine(text: string): string {
  const normalized = text.replace(/\r\n/g, '\n');
  return (normalized.split('\n').find((line) => line.trim().length > 0) ?? '').trim();
}

function clipUnicode(text: string, max: number): string {
  const chars = [...text];
  if (chars.length <= max) return chars.join('');
  return chars.slice(0, max).join('');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function contentJsonOf(doc: unknown): unknown {
  if (isRecord(doc) && 'contentJson' in doc) return doc.contentJson;
  return doc;
}

/** First non-empty top-level block (ATX heading marks stripped), then at most 40 Unicode characters. */
export function titleFromDoc(doc: { contentJson: unknown } | unknown): string {
  const raw = contentJsonOf(doc);
  let blockText = '';
  if (isRecord(raw) && raw.type === 'doc') {
    try {
      const blocks = blocksFromPmJSON(raw as PmJson);
      blockText =
        (blocks.find((block) => block.text.replaceAll('\u200b', '').trim().length > 0)?.text ?? '').trim();
    } catch {
      blockText = '';
    }
  }
  const firstLine = firstNonEmptyLine(blockText);
  const trimmed = firstLine.replace(/^#{1,6}(?:\s+|$)/, '').trim();
  if (trimmed.length === 0) return UNNAMED_DOCUMENT_TITLE;
  return clipUnicode(trimmed, DOCUMENT_TITLE_MAX);
}

/** List/pane title: real title, else description first line (≤40), else 未命名文档. */
export function docDisplayTitle(doc: {
  title: string | null | undefined;
  description?: string | null | undefined;
}): string {
  const title = doc.title?.trim() ?? '';
  if (title.length > 0) return title;
  const fromDesc = firstNonEmptyLine(doc.description ?? '');
  if (fromDesc.length > 0) return clipUnicode(fromDesc, DOCUMENT_TITLE_MAX);
  return UNNAMED_DOCUMENT_TITLE;
}

export const documentSchema = z.object({
  id: z.string().uuid(),
  userId: z.string().uuid(),
  topicId: z.string().uuid().nullable(),
  mapNodeId: z.string().uuid().nullable(),
  title: z.string().nullable(),
  description: z.string().nullable(),
  contentJson: pmDocSchema,
  source: documentSourceSchema,
  kind: z.enum(['document', 'weekly_report']).optional(),
  reportWeekStart: z.string().nullable().optional(),
  status: documentStatusSchema,
  /** 消化失败原因（status='failed' 时有值，离开 failed 状态清空）。 */
  failReason: z.string().nullable(),
  answer: z.string().nullable(),
  linkHint: z.string().nullable(),
  fileMime: z.string().nullable(),
  pageCount: z.number().int().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
  /** 回收站软删除时间；null = 正常文档。 */
  deletedAt: z.string().nullable().optional(),
});
export type Document = z.infer<typeof documentSchema>;

export const createDocumentInputSchema = z.object({
  title: z.string().trim().min(1).max(500).optional(),
  contentJson: pmDocSchema,
  topicId: z.string().uuid().optional(),
  source: z.enum(['editor', 'paste']).optional(),
});
export type CreateDocumentInput = z.infer<typeof createDocumentInputSchema>;

/** Open-API (PAT) creation: raw html/markdown in, server converts to PM JSON. */
export const MAX_OPEN_CONTENT_BYTES = 3 * 1024 * 1024;
export const openCreateDocumentInputSchema = z
  .object({
    title: z.string().trim().min(1).max(500),
    html: z.string().min(1).max(MAX_OPEN_CONTENT_BYTES).optional(),
    markdown: z.string().min(1).max(MAX_OPEN_CONTENT_BYTES).optional(),
    sourceUrl: z.string().url().max(2048).optional(),
    topicId: z.string().uuid().optional(),
  })
  .refine((value) => (value.html !== undefined) !== (value.markdown !== undefined), {
    message: 'exactly one of html or markdown is required',
  });
export type OpenCreateDocumentInput = z.infer<typeof openCreateDocumentInputSchema>;

export const updateDocumentInputSchema = z
  .object({
    title: z.string().trim().min(1).max(500).nullable().optional(),
    contentJson: pmDocSchema.optional(),
    topicId: z.string().uuid().nullable().optional(),
  })
  .refine(
    (value) =>
      value.title !== undefined || value.contentJson !== undefined || value.topicId !== undefined,
    {
      message: 'title, contentJson, or topicId required',
    },
  );
export type UpdateDocumentInput = z.infer<typeof updateDocumentInputSchema>;

export const createChatInputSchema = z.object({
  question: z.string().trim().min(1).max(100_000),
  topicId: z.string().uuid().optional(),
});
export type CreateChatInput = z.infer<typeof createChatInputSchema>;

export const createSelectionCardsInputSchema = z.object({
  text: z.string().trim().min(1).max(100_000),
  blockIndex: z.number().int().positive(),
});
export type CreateSelectionCardsInput = z.infer<typeof createSelectionCardsInputSchema>;

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

/** 回收站里的文档（settings 回收站页）。 */
export const archivedDocumentsResponseSchema = z.object({
  items: z.array(documentSchema),
  total: z.number().int().nonnegative(),
});
export type ArchivedDocumentsResponse = z.infer<typeof archivedDocumentsResponseSchema>;

export const documentCardSchema = cardWithQuestionsSchema.extend({
  review: cardReviewSummarySchema.nullable(),
});
export type DocumentCard = z.infer<typeof documentCardSchema>;

export const documentDetailSchema = documentSchema.extend({
  cards: z.array(documentCardSchema),
  topicTitle: z.string().nullable(),
});
export type DocumentDetail = z.infer<typeof documentDetailSchema>;

export const SCREENSHOT_MAX_BYTES = 10 * 1024 * 1024;
export const SCREENSHOT_MIMES = ['image/png', 'image/jpeg', 'image/webp'] as const;
export type ScreenshotMime = (typeof SCREENSHOT_MIMES)[number];

export const screenshotInitInputSchema = z.object({
  contentType: z.enum(SCREENSHOT_MIMES),
  sizeBytes: z.number().int().positive().max(SCREENSHOT_MAX_BYTES),
  title: z.string().trim().min(1).max(DOCUMENT_TITLE_MAX).optional(),
  topicId: z.string().uuid().optional(),
});
export type ScreenshotInitInput = z.infer<typeof screenshotInitInputSchema>;

export const screenshotInitResponseSchema = z.object({
  document: documentSchema,
  uploadUrl: z.string().url(),
  key: z.string().min(1),
});
export type ScreenshotInitResponse = z.infer<typeof screenshotInitResponseSchema>;

export const importInitInputSchema = z.object({
  filename: z.string().trim().min(1).max(500),
  mime: z.string().trim().min(1).max(127),
  size: z.number().int().positive(),
  topicId: z.string().uuid().optional(),
});
export type ImportInitInput = z.infer<typeof importInitInputSchema>;

export const importInitResponseSchema = z.object({
  documentId: z.string().uuid(),
  uploadId: z.string().min(1),
  key: z.string().min(1),
});
export type ImportInitResponse = z.infer<typeof importInitResponseSchema>;

export const importPartsInputSchema = z.object({
  uploadId: z.string().min(1),
  partNumbers: z.array(z.number().int().positive().max(10_000)).min(1).max(1000),
});
export type ImportPartsInput = z.infer<typeof importPartsInputSchema>;

export const importPartUrlSchema = z.object({
  partNumber: z.number().int().positive(),
  url: z.string().url(),
});
export type ImportPartUrl = z.infer<typeof importPartUrlSchema>;

export const importPartsResponseSchema = z.object({
  parts: z.array(importPartUrlSchema),
});
export type ImportPartsResponse = z.infer<typeof importPartsResponseSchema>;

export const importCompletePartSchema = z.object({
  partNumber: z.number().int().positive().max(10_000),
  etag: z.string().min(1).max(200),
  size: z.number().int().positive(),
});
export type ImportCompletePart = z.infer<typeof importCompletePartSchema>;

export const importCompleteInputSchema = z.object({
  uploadId: z.string().min(1),
  parts: z.array(importCompletePartSchema).min(1).max(10_000),
});
export type ImportCompleteInput = z.infer<typeof importCompleteInputSchema>;

export const importAbortInputSchema = z.object({
  uploadId: z.string().min(1),
});
export type ImportAbortInput = z.infer<typeof importAbortInputSchema>;

export const documentFileResponseSchema = z.object({
  url: z.string().url(),
  mime: z.string().min(1),
});
export type DocumentFileResponse = z.infer<typeof documentFileResponseSchema>;

export const EXCERPT_MAX_BYTES = 5 * 1024 * 1024;

export const excerptUploadInputSchema = z.object({
  contentType: z.string().min(1).max(127),
  sizeBytes: z.number().int().positive().max(EXCERPT_MAX_BYTES),
});
export type ExcerptUploadInput = z.infer<typeof excerptUploadInputSchema>;

export const excerptUploadResponseSchema = z.object({
  uploadUrl: z.string().url(),
  key: z.string().min(1).max(500),
});
export type ExcerptUploadResponse = z.infer<typeof excerptUploadResponseSchema>;
