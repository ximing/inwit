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
  it('sorts, trims etags, and requires consecutive parts starting at 1', () => {
    expect(
      validateCompleteParts([
        { partNumber: 2, etag: ' b ' },
        { partNumber: 1, etag: 'a' },
      ]),
    ).toEqual([
      { partNumber: 1, etag: 'a' },
      { partNumber: 2, etag: 'b' },
    ]);
  });

  it('rejects gaps, duplicates, empty etags, or an empty list', () => {
    expectAppError(() => validateCompleteParts([]), 400, 'VALIDATION_ERROR');
    expectAppError(
      () => validateCompleteParts([{ partNumber: 1, etag: 'a' }, { partNumber: 3, etag: 'c' }]),
      400,
      'VALIDATION_ERROR',
    );
    expectAppError(
      () => validateCompleteParts([{ partNumber: 2, etag: 'a' }]),
      400,
      'VALIDATION_ERROR',
    );
    expectAppError(
      () =>
        validateCompleteParts([
          { partNumber: 1, etag: 'a' },
          { partNumber: 1, etag: 'b' },
        ]),
      400,
      'VALIDATION_ERROR',
    );
    expectAppError(() => validateCompleteParts([{ partNumber: 1, etag: '   ' }]), 400, 'VALIDATION_ERROR');
  });
});
