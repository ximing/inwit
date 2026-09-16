import { describe, expect, it } from 'vitest';
import { EMPTY_PM_DOC } from './content-json.js';
import { followUpAfterExtract, retryJobKindForDocument } from './extract-logic.js';

const FILE_KEY = 'docs/u/d/source.pdf';

function para(text: string) {
  if (text.replaceAll('\u200b', '').trim().length === 0) {
    return { type: 'doc' as const, content: [{ type: 'paragraph' }] };
  }
  return {
    type: 'doc' as const,
    content: [{ type: 'paragraph', content: [{ type: 'text', text }] }],
  };
}

describe('followUpAfterExtract', () => {
  it('enqueues digest when text is present', () => {
    expect(followUpAfterExtract(para('# 标题\n\n正文'), 'pdf')).toBe('digest');
    expect(followUpAfterExtract(para('hello'), 'txt')).toBe('digest');
  });

  it('enqueues ocr for empty PDFs and none for other empty formats', () => {
    expect(followUpAfterExtract(EMPTY_PM_DOC, 'pdf')).toBe('ocr');
    expect(followUpAfterExtract(para('  \n\t  '), 'pdf')).toBe('ocr');
    expect(followUpAfterExtract(EMPTY_PM_DOC, 'txt')).toBe('none');
    expect(followUpAfterExtract(EMPTY_PM_DOC, 'docx')).toBe('none');
    expect(followUpAfterExtract(para('\u200b'), 'md')).toBe('none');
  });
});

describe('retryJobKindForDocument', () => {
  it('returns extract when a file is present but extract has not run', () => {
    expect(
      retryJobKindForDocument({
        status: 'pending',
        contentJson: EMPTY_PM_DOC,
        fileKey: FILE_KEY,
        fileMime: 'application/pdf',
        pageCount: null,
      }),
    ).toBe('extract');
    expect(
      retryJobKindForDocument({
        status: 'failed',
        contentJson: EMPTY_PM_DOC,
        fileKey: 'docs/u/d/source.txt',
        fileMime: 'text/plain',
        pageCount: null,
      }),
    ).toBe('extract');
  });

  it('returns ocr after extract left a scanned PDF empty', () => {
    expect(
      retryJobKindForDocument({
        status: 'pending',
        contentJson: EMPTY_PM_DOC,
        fileKey: FILE_KEY,
        fileMime: 'application/pdf',
        pageCount: 12,
      }),
    ).toBe('ocr');
    expect(
      retryJobKindForDocument({
        status: 'failed',
        contentJson: para('  '),
        fileKey: FILE_KEY,
        fileMime: 'application/pdf; charset=binary',
        pageCount: 0,
      }),
    ).toBe('ocr');
  });

  it('returns ocr for a screenshot image that never went through extract', () => {
    expect(
      retryJobKindForDocument({
        status: 'failed',
        contentJson: EMPTY_PM_DOC,
        fileKey: 'docs/u/d/source.png',
        fileMime: 'image/png',
        pageCount: null,
      }),
    ).toBe('ocr');
  });

  it('returns digest when text exists and skips digested or empty editor docs', () => {
    expect(
      retryJobKindForDocument({
        status: 'failed',
        contentJson: para('正文'),
        fileKey: FILE_KEY,
        fileMime: 'application/pdf',
        pageCount: 3,
      }),
    ).toBe('digest');
    expect(
      retryJobKindForDocument({
        status: 'pending',
        contentJson: para('正文'),
        fileKey: null,
        fileMime: null,
        pageCount: null,
      }),
    ).toBe('digest');
    expect(
      retryJobKindForDocument({
        status: 'digested',
        contentJson: para('正文'),
        fileKey: FILE_KEY,
        fileMime: 'application/pdf',
        pageCount: 3,
      }),
    ).toBeNull();
    expect(
      retryJobKindForDocument({
        status: 'failed',
        contentJson: EMPTY_PM_DOC,
        fileKey: null,
        fileMime: null,
        pageCount: null,
      }),
    ).toBeNull();
  });
});
