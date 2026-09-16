import { describe, expect, it } from 'vitest';
import { followUpAfterExtract, retryJobKindForDocument } from './extract-logic.js';

const FILE_KEY = 'docs/u/d/source.pdf';

describe('followUpAfterExtract', () => {
  it('enqueues digest when text is present', () => {
    expect(followUpAfterExtract('# 标题\n\n正文', 'pdf')).toBe('digest');
    expect(followUpAfterExtract('hello', 'txt')).toBe('digest');
  });

  it('enqueues ocr for empty PDFs and none for other empty formats', () => {
    expect(followUpAfterExtract('', 'pdf')).toBe('ocr');
    expect(followUpAfterExtract('  \n\t  ', 'pdf')).toBe('ocr');
    expect(followUpAfterExtract('', 'txt')).toBe('none');
    expect(followUpAfterExtract('', 'docx')).toBe('none');
    expect(followUpAfterExtract('\u200b', 'md')).toBe('none');
  });
});

describe('retryJobKindForDocument', () => {
  it('returns extract when a file is present but extract has not run', () => {
    expect(
      retryJobKindForDocument({
        status: 'pending',
        contentMd: '',
        fileKey: FILE_KEY,
        fileMime: 'application/pdf',
        pageCount: null,
      }),
    ).toBe('extract');
    expect(
      retryJobKindForDocument({
        status: 'failed',
        contentMd: '',
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
        contentMd: '',
        fileKey: FILE_KEY,
        fileMime: 'application/pdf',
        pageCount: 12,
      }),
    ).toBe('ocr');
    expect(
      retryJobKindForDocument({
        status: 'failed',
        contentMd: '  ',
        fileKey: FILE_KEY,
        fileMime: 'application/pdf; charset=binary',
        pageCount: 0,
      }),
    ).toBe('ocr');
  });

  it('returns digest when text exists and skips digested or empty editor docs', () => {
    expect(
      retryJobKindForDocument({
        status: 'failed',
        contentMd: '正文',
        fileKey: FILE_KEY,
        fileMime: 'application/pdf',
        pageCount: 3,
      }),
    ).toBe('digest');
    expect(
      retryJobKindForDocument({
        status: 'pending',
        contentMd: '正文',
        fileKey: null,
        fileMime: null,
        pageCount: null,
      }),
    ).toBe('digest');
    expect(
      retryJobKindForDocument({
        status: 'digested',
        contentMd: '正文',
        fileKey: FILE_KEY,
        fileMime: 'application/pdf',
        pageCount: 3,
      }),
    ).toBeNull();
    expect(
      retryJobKindForDocument({
        status: 'failed',
        contentMd: '',
        fileKey: null,
        fileMime: null,
        pageCount: null,
      }),
    ).toBeNull();
  });
});
