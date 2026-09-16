import { describe, expect, it } from 'vitest';
import {
  MULTIPART_PART_SIZE,
  completedBytes,
  matchCheckpoint,
  mergeCompletedParts,
  parseCheckpoint,
  remainingRanges,
  sliceRanges,
  sortedCompleteParts,
} from './multipart-logic';

const P = MULTIPART_PART_SIZE;

const baseCheckpoint = {
  documentId: '11111111-1111-4111-8111-111111111111',
  uploadId: 'upload-1',
  key: 'docs/u/d/source.pdf',
  filename: 'text.pdf',
  size: P + 10,
};

describe('parseCheckpoint', () => {
  it('rejects missing identity fields, non-positive size, or non-array parts', () => {
    expect(parseCheckpoint(null)).toBeNull();
    expect(parseCheckpoint('x')).toBeNull();
    expect(parseCheckpoint({ ...baseCheckpoint, documentId: '' })).toBeNull();
    expect(parseCheckpoint({ ...baseCheckpoint, uploadId: '' })).toBeNull();
    expect(parseCheckpoint({ ...baseCheckpoint, key: '' })).toBeNull();
    expect(parseCheckpoint({ ...baseCheckpoint, filename: '' })).toBeNull();
    expect(parseCheckpoint({ ...baseCheckpoint, size: 0 })).toBeNull();
    expect(parseCheckpoint({ ...baseCheckpoint, size: Number.NaN })).toBeNull();
    expect(parseCheckpoint({ ...baseCheckpoint, parts: { partNumber: 1 } })).toBeNull();
  });

  it('accepts an empty parts list so resume re-uploads every slice', () => {
    const checkpoint = parseCheckpoint({ ...baseCheckpoint, parts: [] });
    expect(checkpoint).toEqual({ ...baseCheckpoint, parts: [] });
  });

  it('keeps parts that record size', () => {
    const checkpoint = parseCheckpoint({
      ...baseCheckpoint,
      parts: [
        { partNumber: 2, etag: ' b ', size: 10 },
        { partNumber: 1, etag: 'a', size: P },
      ],
    });
    expect(checkpoint?.parts).toEqual([
      { partNumber: 1, etag: 'a', size: P },
      { partNumber: 2, etag: 'b', size: 10 },
    ]);
  });

  it('drops legacy parts without size so resume re-uploads them', () => {
    const checkpoint = parseCheckpoint({
      ...baseCheckpoint,
      parts: [
        { partNumber: 1, etag: 'a' },
        { partNumber: 2, etag: 'b', size: 10 },
      ],
    });
    expect(checkpoint).not.toBeNull();
    expect(checkpoint?.documentId).toBe(baseCheckpoint.documentId);
    expect(checkpoint?.parts).toEqual([{ partNumber: 2, etag: 'b', size: 10 }]);
  });
});

describe('remainingRanges', () => {
  it('returns every slice when nothing is completed', () => {
    const size = P + 10;
    expect(remainingRanges(size, [])).toEqual(sliceRanges(size));
  });

  it('re-uploads parts whose recorded size does not match the 5MB convention', () => {
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
  });

  it('treats a short last part of the correct remainder as done', () => {
    const size = P + 10;
    expect(
      remainingRanges(size, [
        { partNumber: 1, etag: 'a', size: P },
        { partNumber: 2, etag: 'b', size: 10 },
      ]),
    ).toEqual([]);
  });
});

describe('mergeCompletedParts / sortedCompleteParts / completedBytes', () => {
  it('replaces an existing partNumber and trims the etag', () => {
    expect(
      mergeCompletedParts(
        [
          { partNumber: 1, etag: 'old', size: P },
          { partNumber: 2, etag: 'b', size: 10 },
        ],
        { partNumber: 1, etag: ' new ', size: P },
      ),
    ).toEqual([
      { partNumber: 1, etag: 'new', size: P },
      { partNumber: 2, etag: 'b', size: 10 },
    ]);
  });

  it('preserves size when merging and sorting', () => {
    const merged = mergeCompletedParts([{ partNumber: 1, etag: 'a', size: P }], {
      partNumber: 2,
      etag: ' b ',
      size: 10,
    });
    expect(merged).toEqual([
      { partNumber: 1, etag: 'a', size: P },
      { partNumber: 2, etag: 'b', size: 10 },
    ]);
    expect(sortedCompleteParts([{ partNumber: 2, etag: 'b', size: 10 }, { partNumber: 1, etag: 'a', size: P }])).toEqual(
      merged,
    );
  });

  it('drops parts with a missing or non-positive size', () => {
    expect(
      sortedCompleteParts([
        { partNumber: 1, etag: 'a', size: 0 },
        { partNumber: 2, etag: 'b', size: 10 },
      ]),
    ).toEqual([{ partNumber: 2, etag: 'b', size: 10 }]);
  });

  it('counts recorded part sizes', () => {
    expect(completedBytes([{ partNumber: 1, etag: 'a', size: P }], P + 10)).toBe(P);
    expect(
      completedBytes(
        [
          { partNumber: 1, etag: 'a', size: P },
          { partNumber: 2, etag: 'b', size: 10 },
        ],
        P + 10,
      ),
    ).toBe(P + 10);
  });
});

describe('matchCheckpoint', () => {
  it('resumes only when filename, size, and lastModified all match', () => {
    const saved = parseCheckpoint({
      ...baseCheckpoint,
      lastModified: 1_700_000_000_000,
      parts: [{ partNumber: 1, etag: 'a', size: P }],
    });
    expect(saved).not.toBeNull();
    expect(
      matchCheckpoint([saved!], baseCheckpoint.filename, baseCheckpoint.size, 1_700_000_000_000),
    ).toBe(saved);
    expect(
      matchCheckpoint([saved!], baseCheckpoint.filename, baseCheckpoint.size + 1, 1_700_000_000_000),
    ).toBeNull();
    expect(matchCheckpoint([saved!], 'other.pdf', baseCheckpoint.size, 1_700_000_000_000)).toBeNull();
    expect(
      matchCheckpoint([saved!], baseCheckpoint.filename, baseCheckpoint.size, 1_700_000_000_001),
    ).toBeNull();
  });

  it('does not resume a legacy checkpoint that lacks lastModified', () => {
    const saved = parseCheckpoint({
      ...baseCheckpoint,
      parts: [{ partNumber: 1, etag: 'a', size: P }],
    });
    expect(saved).not.toBeNull();
    expect(saved?.lastModified).toBeUndefined();
    expect(
      matchCheckpoint([saved!], baseCheckpoint.filename, baseCheckpoint.size, 1_700_000_000_000),
    ).toBeNull();
  });
});
