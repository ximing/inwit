import { z } from 'zod';
import { createLlmConfigInputSchema, llmConfigSchema, llmProviderSchema } from './llm.js';

export const PDF_TRANSLATION_STATES = [
  'queued',
  'preparing',
  'dispatched',
  'succeeded',
  'failed',
  'unknown',
  'cancelled',
] as const;
export const pdfTranslationStateSchema = z.enum(PDF_TRANSLATION_STATES);
export type PdfTranslationState = z.infer<typeof pdfTranslationStateSchema>;
export const translationUsageSchema = z.object({
  usageStatus: z.enum(['known', 'partial', 'unknown']),
  inputTokens: z.number().int().nonnegative().nullable(),
  outputTokens: z.number().int().nonnegative().nullable(),
  totalTokens: z.number().int().nonnegative().nullable(),
});
export type TranslationUsage = z.infer<typeof translationUsageSchema>;
export const translationModelSnapshotSchema = z.object({
  provider: llmProviderSchema,
  model: z.string(),
  baseUrl: z.string(),
  configId: z.string().uuid(),
  credentialVersionId: z.string().uuid(),
});
export type TranslationModelSnapshot = z.infer<typeof translationModelSnapshotSchema>;
export const translationSettingsSchema = z.object({
  config: llmConfigSchema.nullable(),
  targetLanguage: z.literal('zh-CN'),
});
export type TranslationSettings = z.infer<typeof translationSettingsSchema>;
export const updateTranslationSettingsSchema = z.union([
  z.object({ copyFromConfigId: z.string().uuid() }),
  createLlmConfigInputSchema
    .omit({ isDefault: true })
    .extend({ apiKey: z.string().min(1).max(512).optional() }),
]);
export type UpdateTranslationSettings = z.infer<typeof updateTranslationSettingsSchema>;
export const pdfPointSchema = z.object({ x: z.number().finite(), y: z.number().finite() });
export type PdfPoint = z.infer<typeof pdfPointSchema>;
export const pdfQuadSchema = z.tuple([
  pdfPointSchema,
  pdfPointSchema,
  pdfPointSchema,
  pdfPointSchema,
]);
export type PdfQuad = z.infer<typeof pdfQuadSchema>;
export const pdfPageGeometrySchema = z.object({
  coordinateVersion: z.literal('crop-local-points-v1'),
  cropBox: z
    .tuple([z.number(), z.number(), z.number(), z.number()])
    .describe('Effective visible box; compatibility alias, not raw CropBox'),
  effectiveCropBox: z.tuple([z.number(), z.number(), z.number(), z.number()]).optional(),
  rawCropBox: z.null().optional(),
  userUnit: z.number().positive(),
  intrinsicRotation: z.union([z.literal(0), z.literal(90), z.literal(180), z.literal(270)]),
  width: z.number().positive(),
  height: z.number().positive(),
});
export type PdfPageGeometry = z.infer<typeof pdfPageGeometrySchema>;
export const pdfSegmentSchema = z.object({
  id: z.string().min(1),
  pageIndex: z.number().int().nonnegative(),
  ordinal: z.number().int().nonnegative(),
  sourceText: z.string(),
  textHash: z.string(),
  rects: z.array(pdfQuadSchema),
  qualityState: z.enum(['reliable', 'unsupported']),
  hasTranslation: z.boolean().optional(),
});
export type PdfSegment = z.infer<typeof pdfSegmentSchema>;
export const pdfSegmentsPageSchema = z.object({
  documentId: z.string().uuid(),
  fileRevision: z.string(),
  parserVersion: z.string(),
  pageIndex: z.number().int().nonnegative(),
  geometry: pdfPageGeometrySchema.nullable(),
  segments: z.array(pdfSegmentSchema),
  state: z.enum(['ready', 'no_text', 'unsupported', 'indexing', 'failed']),
  diagnostics: z.array(z.string()),
});
export type PdfSegmentsPage = z.infer<typeof pdfSegmentsPageSchema>;
export const pdfTranslationSchema = z.object({
  id: z.string().uuid(),
  documentId: z.string().uuid(),
  fileRevision: z.string(),
  pageIndex: z.number().int().nonnegative(),
  sourceText: z.string(),
  translatedText: z.string(),
  generationRevision: z.number().int(),
  model: translationModelSnapshotSchema.omit({ credentialVersionId: true, configId: true }),
  usage: translationUsageSchema,
  createdAt: z.string(),
});
export type PdfTranslation = z.infer<typeof pdfTranslationSchema>;
export const pdfTranslationDraftSchema = z.object({
  streamId: z.string().uuid(),
  seq: z.string().regex(/^\d+$/),
  text: z.string(),
  updatedAt: z.string(),
});
export type PdfTranslationDraft = z.infer<typeof pdfTranslationDraftSchema>;
export const pdfTranslationJobSchema = z.object({
  draft: pdfTranslationDraftSchema.nullable().optional(),
  fileRevision: z.string().optional(),
  generationRevision: z.number().int().optional(),
  id: z.string().uuid(),
  state: pdfTranslationStateSchema,
  errorCode: z.string().nullable(),
  translation: pdfTranslationSchema.nullable(),
  usage: translationUsageSchema,
  canCancel: z.boolean(),
});
export type PdfTranslationJob = z.infer<typeof pdfTranslationJobSchema>;
export const pdfTranslationResponseSchema = z.object({
  cacheHit: z.boolean(),
  requestUsage: z.literal(0).nullable(),
  translation: pdfTranslationSchema.nullable(),
  job: pdfTranslationJobSchema.nullable(),
});
export type PdfTranslationResponse = z.infer<typeof pdfTranslationResponseSchema>;
export const translationRequestSchema = z.object({
  segmentId: z.string().min(1),
  fileRevision: z.string().min(1),
  idempotencyKey: z.string().uuid(),
});
export type TranslationRequest = z.infer<typeof translationRequestSchema>;
export const selectionTranslationRequestSchema = z.object({
  pageIndex: z.number().int().nonnegative(),
  text: z.string().min(1),
  rects: z.array(pdfQuadSchema).min(1),
  fileRevision: z.string().min(1),
  idempotencyKey: z.string().uuid(),
});
export type SelectionTranslationRequest = z.infer<typeof selectionTranslationRequestSchema>;
export const translationRetrySchema = z.object({
  idempotencyKey: z.string().uuid(),
  acknowledgeUnknownCharge: z.boolean().optional(),
});
export const translationRegenerateSchema = z.object({ idempotencyKey: z.string().uuid() });
export const translationDocumentParamsSchema = z.object({ id: z.string().uuid() });
export const translationJobParamsSchema = translationDocumentParamsSchema.extend({
  jobId: z.string().uuid(),
});
export const translationResultParamsSchema = translationDocumentParamsSchema.extend({
  translationId: z.string().uuid(),
});
export const pdfSegmentsQuerySchema = z.object({
  pageIndex: z.coerce.number().int().nonnegative(),
});
export const translationsQuerySchema = z.object({
  segmentIds: z
    .string()
    .transform((s) => s.split(','))
    .pipe(z.array(z.string().min(1)).max(100)),
  fileRevision: z.string().min(1),
});

export const translationSettingsTestSchema = z.object({
  ok: z.boolean(),
  errorCode: z.string().nullable(),
  usage: translationUsageSchema,
});
export type TranslationSettingsTest = z.infer<typeof translationSettingsTestSchema>;
export const translationsResponseSchema = z.record(z.string(), pdfTranslationResponseSchema);
export type TranslationsResponse = z.infer<typeof translationsResponseSchema>;
