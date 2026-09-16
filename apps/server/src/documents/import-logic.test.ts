import { MIME_BY_FORMAT } from '@inwit/dto';
import { describe, expect, it } from 'vitest';
import { AppError } from '../errors.js';
import {
  DEFAULT_IMPORT_MAX_FILE_BYTES,
  detectImportFormat,
  documentObjectPrefix,
  formatFromSourceKey,
  importSourceKey,
  isImportSourceKey,
  isPdfMime,
  normalizeExtractedText,
  PDF_PAGE_BREAK,
  titleFromFilename,
  validateImportFile,
} from './import-logic.js';

function expectAppError(fn: () => unknown, status: number, code: string): void {
  try {
    fn();
  } catch (err) {
    expect(err).toBeInstanceOf(AppError);
    expect((err as AppError).status).toBe(status);
    expect((err as AppError).code).toBe(code);
    return;
  }
  expect.fail('expected AppError');
}

describe('detectImportFormat', () => {
  it('detects by extension, ignoring mimetype when the extension is known', () => {
    expect(detectImportFormat('notes.md', 'text/plain')).toBe('md');
    expect(detectImportFormat('Paper.PDF', 'application/octet-stream')).toBe('pdf');
    expect(detectImportFormat('/tmp/book.epub', '')).toBe('epub');
    expect(detectImportFormat('C:\\\\Users\\\\a\\\\essay.docx', 'text/plain')).toBe('docx');
    expect(detectImportFormat('  draft.txt  ', 'application/pdf')).toBe('txt');
  });

  it('falls back to mimetype when there is no extension', () => {
    expect(detectImportFormat('README', 'text/plain; charset=utf-8')).toBe('txt');
    expect(detectImportFormat('untitled', 'text/markdown')).toBe('md');
    expect(detectImportFormat('', 'application/pdf')).toBe('pdf');
    expect(detectImportFormat('file', 'application/epub+zip')).toBe('epub');
    expect(
      detectImportFormat(
        'file',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      ),
    ).toBe('docx');
  });

  it('throws 415 for unsupported extensions even if mimetype looks valid', () => {
    expectAppError(
      () => detectImportFormat('malware.exe', 'application/pdf'),
      415,
      'IMPORT_UNSUPPORTED_TYPE',
    );
    expectAppError(
      () => detectImportFormat('notes.markdown', 'text/plain'),
      415,
      'IMPORT_UNSUPPORTED_TYPE',
    );
    expectAppError(() => detectImportFormat('file', 'application/zip'), 415, 'IMPORT_UNSUPPORTED_TYPE');
    expectAppError(() => detectImportFormat('', ''), 415, 'IMPORT_UNSUPPORTED_TYPE');
  });
});

describe('titleFromFilename', () => {
  it('strips the extension, path, and extra whitespace', () => {
    expect(titleFromFilename('notes.md')).toBe('notes');
    expect(titleFromFilename('  My   Paper.PDF ')).toBe('My Paper');
    expect(titleFromFilename('/tmp/archive.tar.md')).toBe('archive.tar');
    expect(titleFromFilename('C:\\\\docs\\\\梯度消失.docx')).toBe('梯度消失');
  });

  it('falls back when the stem is empty', () => {
    expect(titleFromFilename('')).toBe('未命名文档');
    expect(titleFromFilename('   ')).toBe('未命名文档');
    expect(titleFromFilename('.md')).toBe('.md');
  });
});

const USER_ID = '11111111-1111-4111-8111-111111111111';
const DOC_ID = '22222222-2222-4222-8222-222222222222';

describe('validateImportFile', () => {
  it('accepts a whitelist extension and returns canonical mime', () => {
    expect(validateImportFile('Paper.PDF', 'application/octet-stream', 1024)).toEqual({
      format: 'pdf',
      mime: MIME_BY_FORMAT.pdf,
      ext: 'pdf',
    });
    expect(validateImportFile('notes.md', 'text/plain', 1)).toEqual({
      format: 'md',
      mime: MIME_BY_FORMAT.md,
      ext: 'md',
    });
  });

  it('rejects empty, non-finite, or oversized payloads and unsupported types', () => {
    expectAppError(() => validateImportFile('a.pdf', 'application/pdf', 0), 400, 'VALIDATION_ERROR');
    expectAppError(
      () => validateImportFile('a.pdf', 'application/pdf', DEFAULT_IMPORT_MAX_FILE_BYTES + 1),
      400,
      'VALIDATION_ERROR',
    );
    expectAppError(
      () => validateImportFile('a.exe', 'application/pdf', 10),
      415,
      'IMPORT_UNSUPPORTED_TYPE',
    );
  });
});

describe('import source key', () => {
  it('builds docs/{userId}/{docId}/source.{ext} and accepts only that shape', () => {
    const key = importSourceKey(USER_ID, DOC_ID, 'pdf');
    expect(key).toBe(`docs/${USER_ID}/${DOC_ID}/source.pdf`);
    expect(documentObjectPrefix(USER_ID, DOC_ID)).toBe(`docs/${USER_ID}/${DOC_ID}/`);
    expect(isImportSourceKey(key, USER_ID, DOC_ID)).toBe(true);
    expect(isImportSourceKey(importSourceKey(USER_ID, DOC_ID, 'md'), USER_ID, DOC_ID)).toBe(true);
    expect(formatFromSourceKey(key)).toBe('pdf');
  });

  it('rejects another user, extra segments, or unknown extensions', () => {
    expect(isImportSourceKey(`docs/${USER_ID}/${DOC_ID}/source.exe`, USER_ID, DOC_ID)).toBe(false);
    expect(isImportSourceKey(`docs/${USER_ID}/${DOC_ID}/excerpts/a.png`, USER_ID, DOC_ID)).toBe(false);
    expect(isImportSourceKey(`docs/${USER_ID}/other/source.pdf`, USER_ID, DOC_ID)).toBe(false);
    expect(formatFromSourceKey(`docs/${USER_ID}/${DOC_ID}/source.exe`)).toBeNull();
  });
});

describe('isPdfMime', () => {
  it('recognizes pdf mime types and ignores parameters', () => {
    expect(isPdfMime('application/pdf')).toBe(true);
    expect(isPdfMime('application/x-pdf; charset=binary')).toBe(true);
    expect(isPdfMime('text/plain')).toBe(false);
    expect(isPdfMime(null)).toBe(false);
  });
});

describe('normalizeExtractedText', () => {
  it('unifies newlines, collapses 3+ blank lines, and trims', () => {
    expect(normalizeExtractedText('  a\r\n\r\n\r\n\r\nb\r\n  ', 'txt')).toBe('a\n\nb');
    expect(normalizeExtractedText('\n\nhello\n\n\n\nworld\n', 'md')).toBe('hello\n\nworld');
  });

  it('joins PDF pages with a markdown separator', () => {
    expect(normalizeExtractedText(`page1${PDF_PAGE_BREAK}\n\n\npage2${PDF_PAGE_BREAK}`, 'pdf')).toBe(
      'page1\n\n---\n\npage2',
    );
    expect(normalizeExtractedText(`  ${PDF_PAGE_BREAK}only${PDF_PAGE_BREAK}  `, 'pdf')).toBe('only');
  });
});
