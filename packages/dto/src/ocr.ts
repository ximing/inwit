import { z } from 'zod';

export const OCR_DEFAULT_MODEL = 'qwen-vl-ocr';

/** Public OCR config — encrypted key never leaves the server. */
export const ocrConfigSchema = z.object({
  id: z.string().uuid(),
  userId: z.string().uuid(),
  model: z.string().min(1).max(128),
  baseUrl: z.string().max(512).nullable(),
  /** First 6 chars of the key + ****. Never the full secret. */
  apiKeyPreview: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type OcrConfig = z.infer<typeof ocrConfigSchema>;

/** `apiKey` omitted means leave the stored key unchanged. */
export const upsertOcrConfigInputSchema = z.object({
  apiKey: z.string().min(1).max(512).optional(),
  model: z.string().min(1).max(128).default(OCR_DEFAULT_MODEL),
  baseUrl: z.string().url().max(512).nullable().optional(),
});
export type UpsertOcrConfigInput = z.infer<typeof upsertOcrConfigInputSchema>;

export const ocrTestResultSchema = z.discriminatedUnion('ok', [
  z.object({ ok: z.literal(true) }),
  z.object({ ok: z.literal(false), error: z.string() }),
]);
export type OcrTestResult = z.infer<typeof ocrTestResultSchema>;
