import { MULTIPART_PART_SIZE } from '@inwit/dto';
import { describe, expect, it } from 'vitest';
import {
  completedBytes,
  importFailMessage,
  importFormatOf,
  findResumeCheckpoint,
  matchCheckpoint,
  mergeCompletedParts,
  parseCheckpoint,
  percentComplete,
  readEtagHeader,
  remainingRanges,
  screenshotContentType,
  sliceRanges,
  sortedCompleteParts,
} from './import-logic';

const P = MULTIPART_PART_SIZE;

const baseCheckpoint = {
  documentId: '11111111-1111-4111-8111-111111111111',
  uploadId: 'upload-1',
  key: 'docs/u/d/source.pdf',
  filename: 'text.pdf',
  size: P + 10,
};

describe('sliceRanges / remainingRanges', () => {
  it('splits on 5 MiB boundaries and keeps a short last part', () => {
    expect(sliceRanges(100)).toEqual([{ partNumber: 1, start: 0, endExclusive: 100 }]);
    expect(sliceRanges(P + 10)).toEqual([
      { partNumber: 1, start: 0, endExclusive: P },
      { partNumber: 2, start: P, endExclusive: P + 10 },
    ]);
  });

  it('returns every slice when nothing is completed', () => {
    const size = P + 10;
    expect(remainingRanges(size, [])).toEqual(sliceRanges(size));
  });

  it('skips parts whose recorded size matches and redoes the rest', () => {
    const size = P + 10;
    expect(remainingRanges(size, [{ partNumber: 1, etag: 'a', size: P }])).toEqual([
      { partNumber: 2, start: P, endExclusive: size },
    ]);
    expect(
      remainingRanges(size, [
        { partNumber: 1, etag: 'a', size: P - 1 },
        { partNumber: 2, etag: 'b', size: 10 },
      ]),
    ).toEqual([{ partNumber: 1, start: 0, endExclusive: P }]);
    expect(
      remainingRanges(size, [
        { partNumber: 1, etag: 'a', size: P },
        { partNumber: 2, etag: 'b', size: 10 },
      ]),
    ).toEqual([]);
  });
});

describe('mergeCompletedParts / percent / etag', () => {
  it('replaces a part, trims the etag, and sorts', () => {
    expect(
      mergeCompletedParts([{ partNumber: 2, etag: 'b', size: 10 }], {
        partNumber: 1,
        etag: ' new ',
        size: P,
      }),
    ).toEqual([
      { partNumber: 1, etag: 'new', size: P },
      { partNumber: 2, etag: 'b', size: 10 },
    ]);
    expect(sortedCompleteParts([{ partNumber: 1, etag: 'a', size: 0 }])).toEqual([]);
    expect(completedBytes([{ partNumber: 1, etag: 'a', size: P }], P + 10)).toBe(P);
    expect(percentComplete(50, 100)).toBe(50);
    expect(percentComplete(0, 0)).toBe(0);
  });

  it('keeps a trimmed etag, including quotes', () => {
    expect(readEtagHeader((name) => (name === 'etag' ? ' "abc" ' : null))).toBe('"abc"');
    expect(readEtagHeader(() => '   ')).toBeNull();
    expect(readEtagHeader(() => null)).toBeNull();
  });
});

describe('checkpoints', () => {
  it('drops legacy parts that have no size', () => {
    const checkpoint = parseCheckpoint({
      ...baseCheckpoint,
      parts: [
        { partNumber: 1, etag: 'a' },
        { partNumber: 2, etag: ' b ', size: 10 },
      ],
    });
    expect(checkpoint?.parts).toEqual([{ partNumber: 2, etag: 'b', size: 10 }]);
  });

  it('resumes only when filename, size, and lastModified all match', () => {
    const saved = parseCheckpoint({
      ...baseCheckpoint,
      lastModified: 100,
      parts: [{ partNumber: 1, etag: 'a', size: P }],
    });
    expect(saved).not.toBeNull();
    expect(matchCheckpoint([saved!], 'text.pdf', baseCheckpoint.size, 100)).toBe(saved);
    expect(matchCheckpoint([saved!], 'text.pdf', baseCheckpoint.size, 101)).toBeNull();
    expect(matchCheckpoint([saved!], 'other.pdf', baseCheckpoint.size, 100)).toBeNull();
    expect(findResumeCheckpoint([saved!], 'text.pdf', baseCheckpoint.size, 101)).toBeNull();
    expect(findResumeCheckpoint([saved!], 'text.pdf', baseCheckpoint.size, 100)).toBe(saved);
  });
});

describe('import messages', () => {
  it('maps unsupported types, size, and parse failures', () => {
    expect(importFailMessage({ status: 415, code: 'IMPORT_UNSUPPORTED_TYPE' })).toBe(
      '不支持这种文件。目前可以导入 PDF、Word、EPUB、TXT 和 Markdown',
    );
    expect(importFailMessage({ status: 413, code: 'PAYLOAD_TOO_LARGE' })).toBe('文件太大了');
    expect(importFailMessage({ status: 422, code: 'IMPORT_EMPTY' })).toBe('这个文件里没有可提取的文字');
    expect(importFailMessage({ status: 422, code: 'IMPORT_PARTS_MISMATCH' })).toBe('分片不完整，请重新上传');
    expect(importFailMessage({ status: 422, code: 'IMPORT_PARSE_FAILED' })).toBe(
      '这个文件解析失败了，可能已加密或损坏',
    );
    expect(importFailMessage(new Error('网络断了'))).toBe('网络断了');
    expect(importFailMessage(null)).toBe('导入失败');
  });

  it('accepts pdf, docx, epub, txt, and md only', () => {
    expect(importFormatOf('notes/a.PDF')).toBe('pdf');
    expect(importFormatOf('a.docx')).toBe('docx');
    expect(importFormatOf('a.epub')).toBe('epub');
    expect(importFormatOf('a.txt')).toBe('txt');
    expect(importFormatOf('a.md')).toBe('md');
    expect(importFormatOf('a.png')).toBeNull();
    expect(importFormatOf('noext')).toBeNull();
  });
});

describe('screenshotContentType', () => {
  it('accepts png, jpeg, and webp, and rejects empty or heic', () => {
    expect(screenshotContentType('image/png')).toBe('image/png');
    expect(screenshotContentType('image/jpg')).toBe('image/jpeg');
    expect(screenshotContentType('image/webp; charset=binary')).toBe('image/webp');
    expect(screenshotContentType('image/heic')).toBeNull();
    expect(screenshotContentType('')).toBeNull();
    expect(screenshotContentType(null)).toBeNull();
  });
});
