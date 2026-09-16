import { EXCERPT_MAX_BYTES } from '@inwit/dto';
import { describe, expect, it } from 'vitest';
import { AppError } from '../errors.js';
import {
  excerptKeyFor,
  isExcerptKeyFor,
  validateExcerptMime,
  validateExcerptUpload,
} from './excerpt-logic.js';

const USER_ID = '11111111-1111-4111-8111-111111111111';
const DOC_ID = '22222222-2222-4222-8222-222222222222';
const FILE_ID = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';

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

describe('validateExcerptMime', () => {
  it('accepts png/jpeg/webp without a size', () => {
    expect(validateExcerptMime('image/png')).toEqual({ mime: 'image/png', ext: 'png' });
    expect(validateExcerptMime('image/jpeg; charset=binary')).toEqual({
      mime: 'image/jpeg',
      ext: 'jpg',
    });
    expect(validateExcerptMime('IMAGE/WEBP')).toEqual({ mime: 'image/webp', ext: 'webp' });
  });

  it('rejects disallowed mime', () => {
    expectAppError(() => validateExcerptMime('image/gif'), 400, 'VALIDATION_ERROR');
    expectAppError(() => validateExcerptMime('application/pdf'), 400, 'VALIDATION_ERROR');
  });
});

describe('validateExcerptUpload', () => {
  it('accepts png/jpeg/webp within 5MB', () => {
    expect(validateExcerptUpload('image/png', 1)).toEqual({ mime: 'image/png', ext: 'png' });
    expect(validateExcerptUpload('image/jpeg; charset=binary', 2048)).toEqual({
      mime: 'image/jpeg',
      ext: 'jpg',
    });
    expect(validateExcerptUpload('IMAGE/WEBP', EXCERPT_MAX_BYTES)).toEqual({
      mime: 'image/webp',
      ext: 'webp',
    });
  });

  it('rejects oversize, empty, or disallowed mime', () => {
    expectAppError(() => validateExcerptUpload('image/png', 0), 400, 'VALIDATION_ERROR');
    expectAppError(
      () => validateExcerptUpload('image/png', EXCERPT_MAX_BYTES + 1),
      400,
      'VALIDATION_ERROR',
    );
    expectAppError(() => validateExcerptUpload('image/gif', 100), 400, 'VALIDATION_ERROR');
    expectAppError(() => validateExcerptUpload('application/pdf', 100), 400, 'VALIDATION_ERROR');
  });
});

describe('excerptKeyFor', () => {
  it('builds docs/{userId}/{docId}/excerpts/{uuid}.{ext}', () => {
    expect(excerptKeyFor(USER_ID, DOC_ID, 'image/png', FILE_ID)).toBe(
      `docs/${USER_ID}/${DOC_ID}/excerpts/${FILE_ID}.png`,
    );
    expect(excerptKeyFor(USER_ID, DOC_ID, 'image/jpeg', FILE_ID)).toBe(
      `docs/${USER_ID}/${DOC_ID}/excerpts/${FILE_ID}.jpg`,
    );
  });
});

describe('isExcerptKeyFor', () => {
  it('accepts keys under the document excerpts prefix', () => {
    const key = excerptKeyFor(USER_ID, DOC_ID, 'image/png', FILE_ID);
    expect(isExcerptKeyFor(key, USER_ID, DOC_ID)).toBe(true);
  });

  it('rejects other users, documents, path traversal, and extra segments', () => {
    const key = excerptKeyFor(USER_ID, DOC_ID, 'image/png', FILE_ID);
    expect(isExcerptKeyFor(key, '33333333-3333-4333-8333-333333333333', DOC_ID)).toBe(false);
    expect(isExcerptKeyFor(key, USER_ID, '33333333-3333-4333-8333-333333333333')).toBe(false);
    expect(isExcerptKeyFor(`docs/${USER_ID}/${DOC_ID}/excerpts/../${FILE_ID}.png`, USER_ID, DOC_ID)).toBe(
      false,
    );
    expect(
      isExcerptKeyFor(`docs/${USER_ID}/${DOC_ID}/excerpts/nested/${FILE_ID}.png`, USER_ID, DOC_ID),
    ).toBe(false);
    expect(isExcerptKeyFor(`docs/${USER_ID}/${DOC_ID}/source.pdf`, USER_ID, DOC_ID)).toBe(false);
  });
});
