import { describe, expect, it } from 'vitest';
import { PDF_PAGE_SEPARATOR } from '../documents/import-logic.js';
import {
  applyPageFailure,
  applyPageSuccess,
  buildOcrChatBody,
  chunkPages,
  initialOcrProgress,
  normalizeOcrText,
  OCR_DEFAULT_BASE_URL,
  OCR_MIN_PIXELS,
  OCR_TEXT_RECOGNITION_PROMPT,
  ocrChatCompletionsUrl,
  ocrIncompleteError,
  ocrPayloadForRetry,
  pagesToMarkdown,
  parseOcrChatContent,
  parseOcrChatResponse,
  parseOcrProgress,
  pendingPages,
  pngToDataUrl,
  redactSecret,
  toOcrJobPayload,
  withTotalPages,
} from './ocr-logic.js';

const DOC_ID = '11111111-1111-4111-8111-111111111111';

describe('buildOcrChatBody', () => {
  it('inlines the image as a data URL and uses the text_recognition prompt', () => {
    const body = buildOcrChatBody({
      model: 'qwen-vl-ocr',
      imageDataUrl: 'data:image/png;base64,abc',
    });
    expect(body.model).toBe('qwen-vl-ocr');
    expect(body.max_tokens).toBe(4096);
    expect(body.ocr_options).toEqual({ task: 'text_recognition' });
    const messages = body.messages as Array<{ content: Array<Record<string, unknown>> }>;
    const content = messages[0]?.content ?? [];
    expect(content[0]).toMatchObject({
      type: 'image_url',
      image_url: { url: 'data:image/png;base64,abc' },
      min_pixels: OCR_MIN_PIXELS,
      enable_rotate: true,
    });
    expect(content[1]).toEqual({ type: 'text', text: OCR_TEXT_RECOGNITION_PROMPT });
  });

  it('uses the document_parsing prompt when requested', () => {
    const body = buildOcrChatBody({
      model: 'qwen-vl-ocr',
      imageDataUrl: 'data:image/png;base64,abc',
      task: 'document_parsing',
    });
    expect(body.ocr_options).toEqual({ task: 'document_parsing' });
    const messages = body.messages as Array<{ content: Array<Record<string, unknown>> }>;
    const text = messages[0]?.content[1]?.text;
    expect(typeof text).toBe('string');
    expect(String(text)).toContain('LaTeX');
  });
});

describe('parseOcrChatResponse', () => {
  it('reads string message content', () => {
    expect(
      parseOcrChatResponse({
        choices: [{ message: { content: '  第一页文字  ' } }],
      }),
    ).toBe('第一页文字');
  });

  it('joins array content and words_info', () => {
    expect(
      parseOcrChatContent([
        { text: '标题' },
        { ocr_result: { words_info: [{ text: '一行' }, { text: '二行' }] } },
      ]),
    ).toBe('标题\n一行\n二行');
  });

  it('strips fenced blocks', () => {
    expect(normalizeOcrText('```json\nhello\n```')).toBe('hello');
  });

  it('throws on API error objects and missing choices', () => {
    expect(() => parseOcrChatResponse({ error: { message: 'invalid api key' } })).toThrow(
      'invalid api key',
    );
    expect(() => parseOcrChatResponse({ choices: [] })).toThrow('ocr response missing choices');
  });
});

describe('pngToDataUrl / urls / redact', () => {
  it('encodes png buffers as data URLs', () => {
    expect(pngToDataUrl(Buffer.from('hi'))).toBe(`data:image/png;base64,${Buffer.from('hi').toString('base64')}`);
  });

  it('joins baseUrl with /chat/completions without double slashes', () => {
    expect(ocrChatCompletionsUrl(OCR_DEFAULT_BASE_URL)).toBe(
      'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions',
    );
    expect(ocrChatCompletionsUrl(`${OCR_DEFAULT_BASE_URL}/`)).toBe(
      'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions',
    );
  });

  it('redacts the secret wherever it appears', () => {
    expect(redactSecret('using sk-abcde failed sk-abcde', 'sk-abcde')).toBe('using *** failed ***');
    expect(redactSecret('no key', '')).toBe('no key');
  });
});

describe('progress / checkpoint', () => {
  it('skips done pages and retries failed ones', () => {
    let progress = initialOcrProgress(DOC_ID, 4);
    progress = applyPageSuccess(progress, 0, 'p0');
    progress = applyPageSuccess(progress, 2, 'p2');
    progress = applyPageFailure(progress, 1);
    expect(pendingPages(progress)).toEqual([1, 3]);
    expect(progress.donePages).toEqual([0, 2]);
    expect(progress.failedPages).toEqual([1]);
  });

  it('success on a failed page moves it to done and stores text', () => {
    let progress = applyPageFailure(initialOcrProgress(DOC_ID, 2), 0);
    progress = applyPageSuccess(progress, 0, 'recovered');
    expect(progress.failedPages).toEqual([]);
    expect(progress.donePages).toEqual([0]);
    expect(progress.pageTexts[0]).toBe('recovered');
  });

  it('chunks pages by batch size', () => {
    expect(chunkPages([0, 1, 2, 3, 4], 2)).toEqual([[0, 1], [2, 3], [4]]);
    expect(chunkPages([], 10)).toEqual([]);
  });

  it('round-trips payload including pageTexts for recover/retry', () => {
    let progress = initialOcrProgress(DOC_ID, 3);
    progress = applyPageSuccess(progress, 0, 'one');
    progress = applyPageFailure(progress, 1);
    const payload = toOcrJobPayload(progress);
    const restored = parseOcrProgress(payload);
    expect(restored).toEqual(progress);
    expect(pendingPages(restored!)).toEqual([1, 2]);
  });

  it('ocrPayloadForRetry keeps completed pages from the previous job', () => {
    const previous = toOcrJobPayload(applyPageSuccess(initialOcrProgress(DOC_ID, 5), 0, 'keep'));
    const retry = ocrPayloadForRetry(DOC_ID, 5, previous);
    const parsed = parseOcrProgress(retry);
    expect(parsed?.donePages).toEqual([0]);
    expect(parsed?.pageTexts[0]).toBe('keep');
    expect(pendingPages(parsed!)).toEqual([1, 2, 3, 4]);
  });

  it('ocrPayloadForRetry starts fresh when previous payload is missing or another document', () => {
    expect(parseOcrProgress(ocrPayloadForRetry(DOC_ID, 2, undefined))).toEqual(
      initialOcrProgress(DOC_ID, 2),
    );
    const other = toOcrJobPayload(initialOcrProgress('22222222-2222-4222-8222-222222222222', 9));
    expect(parseOcrProgress(ocrPayloadForRetry(DOC_ID, 2, other))).toEqual(
      initialOcrProgress(DOC_ID, 2),
    );
  });

  it('withTotalPages drops out-of-range indices when the PDF page count is known', () => {
    let progress = applyPageSuccess(initialOcrProgress(DOC_ID, 0), 0, 'p0');
    progress = applyPageSuccess(progress, 1, 'p1');
    const resized = withTotalPages(progress, 1);
    expect(resized.totalPages).toBe(1);
    expect(resized.donePages).toEqual([0]);
    expect(resized.pageTexts).toEqual(['p0']);
  });
});

describe('pagesToMarkdown', () => {
  it('joins pages with the PDF separator and keeps empty slots', () => {
    expect(pagesToMarkdown(['甲', '', '丙'])).toBe(`甲${PDF_PAGE_SEPARATOR}${PDF_PAGE_SEPARATOR}丙`);
  });

  it('returns empty string when every page is blank', () => {
    expect(pagesToMarkdown(['', '  ', '\n'])).toBe('');
    expect(pagesToMarkdown([])).toBe('');
  });
});

describe('ocrIncompleteError', () => {
  it('lists failed page indexes', () => {
    expect(ocrIncompleteError([2, 7])).toBe('ocr incomplete: failed pages 2,7');
  });
});
