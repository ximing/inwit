import { describe, expect, it } from 'vitest';
import { AppError } from '../errors.js';
import {
  MULTIPART_PART_SIZE,
  S3_MAX_PARTS,
  partCountForSize,
  partNumbersForSize,
  sliceRanges,
  validateCompleteParts,
  validatePartNumbers,
} from './multipart-logic.js';

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

describe('sliceRanges / partCountForSize', () => {
  it('uses a single part for files up to 5MB', () => {
    expect(partCountForSize(1)).toBe(1);
    expect(partCountForSize(MULTIPART_PART_SIZE)).toBe(1);
    expect(sliceRanges(100)).toEqual([{ partNumber: 1, start: 0, endExclusive: 100 }]);
    expect(sliceRanges(MULTIPART_PART_SIZE)).toEqual([
      { partNumber: 1, start: 0, endExclusive: MULTIPART_PART_SIZE },
    ]);
  });

  it('splits on 5MB boundaries and leaves a short last part', () => {
    expect(partCountForSize(MULTIPART_PART_SIZE + 1)).toBe(2);
    expect(sliceRanges(MULTIPART_PART_SIZE + 1)).toEqual([
      { partNumber: 1, start: 0, endExclusive: MULTIPART_PART_SIZE },
      { partNumber: 2, start: MULTIPART_PART_SIZE, endExclusive: MULTIPART_PART_SIZE + 1 },
    ]);
    expect(partNumbersForSize(MULTIPART_PART_SIZE * 2)).toEqual([1, 2]);
    expect(sliceRanges(MULTIPART_PART_SIZE * 2 + 10)[2]).toEqual({
      partNumber: 3,
      start: MULTIPART_PART_SIZE * 2,
      endExclusive: MULTIPART_PART_SIZE * 2 + 10,
    });
  });

  it('rejects non-positive sizes and more than 10000 parts', () => {
    expectAppError(() => partCountForSize(0), 400, 'VALIDATION_ERROR');
    expectAppError(() => partCountForSize(-1), 400, 'VALIDATION_ERROR');
    expectAppError(() => sliceRanges(S3_MAX_PARTS * MULTIPART_PART_SIZE + 1), 400, 'VALIDATION_ERROR');
  });
});

describe('validatePartNumbers', () => {
  it('sorts unique part numbers in 1..10000', () => {
    expect(validatePartNumbers([3, 1, 2])).toEqual([1, 2, 3]);
    expect(validatePartNumbers([S3_MAX_PARTS])).toEqual([S3_MAX_PARTS]);
  });

  it('rejects empty, duplicate, or out-of-range numbers', () => {
    expectAppError(() => validatePartNumbers([]), 400, 'VALIDATION_ERROR');
    expectAppError(() => validatePartNumbers([1, 1]), 400, 'VALIDATION_ERROR');
    expectAppError(() => validatePartNumbers([0]), 400, 'VALIDATION_ERROR');
    expectAppError(() => validatePartNumbers([S3_MAX_PARTS + 1]), 400, 'VALIDATION_ERROR');
    expectAppError(() => validatePartNumbers([1.5]), 400, 'VALIDATION_ERROR');
  });
});

describe('validateCompleteParts', () => {
  const P = MULTIPART_PART_SIZE;

  it('sorts, trims etags, and accepts a short last part', () => {
    expect(
      validateCompleteParts(
        [
          { partNumber: 2, etag: ' b ', size: 10 },
          { partNumber: 1, etag: 'a', size: P },
        ],
        P + 10,
      ),
    ).toEqual([
      { partNumber: 1, etag: 'a', size: P },
      { partNumber: 2, etag: 'b', size: 10 },
    ]);
  });

  it('accepts a single part equal to the whole file', () => {
    expect(validateCompleteParts([{ partNumber: 1, etag: 'a', size: 100 }], 100)).toEqual([
      { partNumber: 1, etag: 'a', size: 100 },
    ]);
    expect(validateCompleteParts([{ partNumber: 1, etag: 'a', size: P }], P)).toEqual([
      { partNumber: 1, etag: 'a', size: P },
    ]);
  });

  it('accepts an exact multiple of the part size (last part full)', () => {
    expect(
      validateCompleteParts(
        [
          { partNumber: 1, etag: 'a', size: P },
          { partNumber: 2, etag: 'b', size: P },
        ],
        P * 2,
      ),
    ).toEqual([
      { partNumber: 1, etag: 'a', size: P },
      { partNumber: 2, etag: 'b', size: P },
    ]);
  });

  it('rejects a truncated prefix (fewer parts than the registered size)', () => {
    expectAppError(
      () => validateCompleteParts([{ partNumber: 1, etag: 'a', size: P }], P + 1),
      422,
      'IMPORT_PARTS_MISMATCH',
    );
  });

  it('rejects extra parts beyond the registered size', () => {
    expectAppError(
      () =>
        validateCompleteParts(
          [
            { partNumber: 1, etag: 'a', size: P },
            { partNumber: 2, etag: 'b', size: 1 },
          ],
          P,
        ),
      422,
      'IMPORT_PARTS_MISMATCH',
    );
  });

  it('rejects a last part whose size does not match the remainder', () => {
    expectAppError(
      () =>
        validateCompleteParts(
          [
            { partNumber: 1, etag: 'a', size: P },
            { partNumber: 2, etag: 'b', size: 9 },
          ],
          P + 10,
        ),
      422,
      'IMPORT_PARTS_MISMATCH',
    );
  });

  it('rejects a non-last part that is not exactly 5MB even if totals match', () => {
    expectAppError(
      () =>
        validateCompleteParts(
          [
            { partNumber: 1, etag: 'a', size: P - 1 },
            { partNumber: 2, etag: 'b', size: 11 },
          ],
          P + 10,
        ),
      422,
      'IMPORT_PARTS_MISMATCH',
    );
  });

  it('rejects skipped part numbers', () => {
    expectAppError(
      () =>
        validateCompleteParts(
          [
            { partNumber: 1, etag: 'a', size: P },
            { partNumber: 3, etag: 'c', size: 10 },
          ],
          P * 2 + 10,
        ),
      422,
      'IMPORT_PARTS_MISMATCH',
    );
    expectAppError(
      () => validateCompleteParts([{ partNumber: 2, etag: 'a', size: 100 }], 100),
      422,
      'IMPORT_PARTS_MISMATCH',
    );
  });

  it('rejects duplicates, empty etags, non-positive sizes, or an empty list', () => {
    expectAppError(() => validateCompleteParts([], 100), 400, 'VALIDATION_ERROR');
    expectAppError(
      () =>
        validateCompleteParts(
          [
            { partNumber: 1, etag: 'a', size: 50 },
            { partNumber: 1, etag: 'b', size: 50 },
          ],
          100,
        ),
      400,
      'VALIDATION_ERROR',
    );
    expectAppError(
      () => validateCompleteParts([{ partNumber: 1, etag: '   ', size: 100 }], 100),
      400,
      'VALIDATION_ERROR',
    );
    expectAppError(
      () => validateCompleteParts([{ partNumber: 1, etag: 'a', size: 0 }], 100),
      400,
      'VALIDATION_ERROR',
    );
  });
});
