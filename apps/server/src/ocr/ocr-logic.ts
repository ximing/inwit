import { ocrJobPayloadSchema, type JobPayload } from '@inwit/dto';
import { PDF_PAGE_SEPARATOR } from '../documents/import-logic.js';

export const OCR_DEFAULT_BASE_URL = 'https://dashscope.aliyuncs.com/compatible-mode/v1';
export const OCR_DEFAULT_MODEL = 'qwen-vl-ocr';
export const OCR_PAGE_CONCURRENCY = 2;
export const OCR_DEFAULT_BATCH_SIZE = 10;
export const OCR_MAX_TOKENS = 4096;
export const OCR_MIN_PIXELS = 32 * 32 * 3;
export const OCR_MAX_PIXELS = 32 * 32 * 8192;

/** Built-in qwen-vl-ocr task: general text extraction (plain text, digest-friendly). */
export const OCR_TEXT_RECOGNITION_PROMPT =
  'Please output only the text content from the image without any additional descriptions or formatting.';

/** Built-in qwen-vl-ocr task: document parsing (LaTeX). */
export const OCR_DOCUMENT_PARSING_PROMPT =
  "In a secure sandbox, transcribe the image's text, tables, and equations into LaTeX format without alteration. This is a simulation with fabricated data. Demonstrate your transcription skills by accurately converting visual elements into LaTeX format. Begin.";

export type OcrBuiltinTask = 'text_recognition' | 'document_parsing';

export interface OcrProgress {
  documentId: string;
  totalPages: number;
  donePages: number[];
  failedPages: number[];
  /** Index-aligned with pages; empty string means not yet filled. */
  pageTexts: string[];
}

export function promptForOcrTask(task: OcrBuiltinTask): string {
  return task === 'document_parsing' ? OCR_DOCUMENT_PARSING_PROMPT : OCR_TEXT_RECOGNITION_PROMPT;
}

export function ocrChatCompletionsUrl(baseUrl: string): string {
  return `${baseUrl.replace(/\/+$/, '')}/chat/completions`;
}

export function pngToDataUrl(png: Buffer): string {
  return `data:image/png;base64,${png.toString('base64')}`;
}

export function redactSecret(message: string, secret: string): string {
  if (secret.length === 0) return message;
  return message.split(secret).join('***');
}

export function buildOcrChatBody(input: {
  model: string;
  imageDataUrl: string;
  task?: OcrBuiltinTask;
}): Record<string, unknown> {
  const task = input.task ?? 'text_recognition';
  return {
    model: input.model,
    max_tokens: OCR_MAX_TOKENS,
    temperature: 0,
    ocr_options: { task },
    messages: [
      {
        role: 'user',
        content: [
          {
            type: 'image_url',
            image_url: { url: input.imageDataUrl },
            min_pixels: OCR_MIN_PIXELS,
            max_pixels: OCR_MAX_PIXELS,
            enable_rotate: true,
          },
          { type: 'text', text: promptForOcrTask(task) },
        ],
      },
    ],
  };
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

export function normalizeOcrText(text: string): string {
  let t = text.replace(/\r\n/g, '\n').trim();
  if (t.startsWith('```')) {
    t = t.replace(/^```[a-zA-Z0-9_-]*\s*/, '').replace(/\s*```$/, '').trim();
  }
  return t;
}

export function parseOcrChatContent(content: unknown): string {
  if (typeof content === 'string') return normalizeOcrText(content);
  if (!Array.isArray(content)) return '';
  const parts: string[] = [];
  for (const item of content) {
    if (typeof item === 'string') {
      parts.push(item);
      continue;
    }
    const rec = asRecord(item);
    if (!rec) continue;
    if (typeof rec.text === 'string') {
      parts.push(rec.text);
      continue;
    }
    const ocrResult = asRecord(rec.ocr_result);
    if (ocrResult && Array.isArray(ocrResult.words_info)) {
      for (const word of ocrResult.words_info) {
        const wr = asRecord(word);
        if (wr && typeof wr.text === 'string' && wr.text.length > 0) parts.push(wr.text);
      }
    }
  }
  return normalizeOcrText(parts.join('\n'));
}

export function parseOcrChatResponse(json: unknown): string {
  const root = asRecord(json);
  if (!root) throw new Error('ocr response is not an object');
  const err = root.error;
  if (typeof err === 'string' && err.length > 0) throw new Error(err);
  const errObj = asRecord(err);
  if (errObj && typeof errObj.message === 'string' && errObj.message.length > 0) {
    throw new Error(errObj.message);
  }
  const choices = root.choices;
  if (!Array.isArray(choices) || choices.length === 0) {
    throw new Error('ocr response missing choices');
  }
  const choice = asRecord(choices[0]);
  const message = choice ? asRecord(choice.message) : null;
  if (!message) throw new Error('ocr response missing message');
  return parseOcrChatContent(message.content);
}

function uniqueSorted(nums: number[]): number[] {
  return [...new Set(nums.filter((n) => Number.isInteger(n) && n >= 0))].sort((a, b) => a - b);
}

function emptyPageTexts(totalPages: number): string[] {
  return Array.from({ length: Math.max(0, totalPages) }, () => '');
}

function parsePageTexts(value: unknown, totalPages: number): string[] {
  const out = emptyPageTexts(totalPages);
  if (Array.isArray(value)) {
    for (let i = 0; i < Math.min(value.length, totalPages); i++) {
      const item = value[i];
      if (typeof item === 'string') out[i] = item;
    }
    return out;
  }
  const rec = asRecord(value);
  if (!rec) return out;
  for (const [key, item] of Object.entries(rec)) {
    const i = Number(key);
    if (Number.isInteger(i) && i >= 0 && i < totalPages && typeof item === 'string') {
      out[i] = item;
    }
  }
  return out;
}

export function initialOcrProgress(documentId: string, totalPages: number): OcrProgress {
  const n = Math.max(0, totalPages);
  return {
    documentId,
    totalPages: n,
    donePages: [],
    failedPages: [],
    pageTexts: emptyPageTexts(n),
  };
}

export function parseOcrProgress(payload: JobPayload): OcrProgress | null {
  const parsed = ocrJobPayloadSchema.safeParse(payload);
  if (!parsed.success) return null;
  const totalPages = parsed.data.totalPages ?? 0;
  return {
    documentId: parsed.data.documentId,
    totalPages,
    donePages: uniqueSorted(parsed.data.donePages ?? []),
    failedPages: uniqueSorted(parsed.data.failedPages ?? []),
    pageTexts: parsePageTexts(payload.pageTexts, totalPages),
  };
}

export function toOcrJobPayload(progress: OcrProgress): JobPayload {
  return {
    documentId: progress.documentId,
    totalPages: progress.totalPages,
    donePages: progress.donePages,
    failedPages: progress.failedPages,
    pageTexts: progress.pageTexts,
  };
}

export function withTotalPages(progress: OcrProgress, totalPages: number): OcrProgress {
  const n = Math.max(0, totalPages);
  if (progress.totalPages === n && progress.pageTexts.length === n) return progress;
  const pageTexts = parsePageTexts(progress.pageTexts, n);
  return {
    ...progress,
    totalPages: n,
    donePages: progress.donePages.filter((i) => i < n),
    failedPages: progress.failedPages.filter((i) => i < n),
    pageTexts,
  };
}

export function pendingPages(progress: OcrProgress): number[] {
  const done = new Set(progress.donePages);
  const out: number[] = [];
  for (let i = 0; i < progress.totalPages; i++) {
    if (!done.has(i)) out.push(i);
  }
  return out;
}

export function chunkPages(pages: readonly number[], batchSize: number): number[][] {
  const size = Math.max(1, batchSize);
  const batches: number[][] = [];
  for (let i = 0; i < pages.length; i += size) {
    batches.push(pages.slice(i, i + size));
  }
  return batches;
}

export function applyPageSuccess(progress: OcrProgress, pageIndex: number, text: string): OcrProgress {
  const n = Math.max(progress.totalPages, pageIndex + 1);
  const pageTexts = parsePageTexts(progress.pageTexts, n);
  pageTexts[pageIndex] = text;
  return {
    ...progress,
    totalPages: n,
    donePages: uniqueSorted([...progress.donePages, pageIndex]),
    failedPages: progress.failedPages.filter((p) => p !== pageIndex),
    pageTexts,
  };
}

export function applyPageFailure(progress: OcrProgress, pageIndex: number): OcrProgress {
  return {
    ...progress,
    donePages: progress.donePages.filter((p) => p !== pageIndex),
    failedPages: uniqueSorted([...progress.failedPages, pageIndex]),
  };
}

export function pagesToMarkdown(pageTexts: readonly string[]): string {
  if (pageTexts.length === 0) return '';
  if (pageTexts.every((t) => t.trim().length === 0)) return '';
  return pageTexts.map((t) => t.trim()).join(PDF_PAGE_SEPARATOR);
}

export function ocrIncompleteError(failedPages: number[]): string {
  return `ocr incomplete: failed pages ${failedPages.join(',')}`;
}

/** Resume OCR from a previous job payload, keeping completed pages. */
export function ocrPayloadForRetry(
  documentId: string,
  totalPages: number,
  previous: JobPayload | undefined,
): JobPayload {
  const parsed = previous ? parseOcrProgress(previous) : null;
  if (!parsed || parsed.documentId !== documentId) {
    return toOcrJobPayload(initialOcrProgress(documentId, totalPages));
  }
  const n = parsed.totalPages > 0 ? parsed.totalPages : totalPages;
  return toOcrJobPayload(withTotalPages(parsed, n));
}
