import {
  ASSET_IMAGE_MAX_BYTES,
  ASSET_VIDEO_MAX_BYTES,
} from '@inwit/dto';
import { describe, expect, it } from 'vitest';
import { AppError } from '../errors.js';
import {
  assetKeyFor,
  assetKeyFromSrc,
  assetSrcFromKey,
  assertOwnedAssetKey,
  classifyResolveSrc,
  classifyResolveSrcs,
  isAssetKey,
  isAssetSrc,
  isHttpSrc,
  validateAssetCompleteParts,
  validateAssetPartNumbers,
  validateAssetUpload,
} from './asset-logic.js';

const USER_ID = '11111111-1111-4111-8111-111111111111';
const OTHER_ID = '22222222-2222-4222-8222-222222222222';
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

describe('validateAssetUpload', () => {
  it('accepts image whitelist mimes within 10MB and maps extensions', () => {
    expect(validateAssetUpload('image', 'image/jpeg', 1)).toEqual({
      mime: 'image/jpeg',
      ext: 'jpg',
    });
    expect(validateAssetUpload('image', 'image/png', 1024)).toEqual({
      mime: 'image/png',
      ext: 'png',
    });
    expect(validateAssetUpload('image', 'IMAGE/WEBP; charset=binary', ASSET_IMAGE_MAX_BYTES)).toEqual({
      mime: 'image/webp',
      ext: 'webp',
    });
    expect(validateAssetUpload('image', 'image/gif', 10)).toEqual({
      mime: 'image/gif',
      ext: 'gif',
    });
  });

  it('accepts video whitelist mimes within 200MB', () => {
    expect(validateAssetUpload('video', 'video/mp4', 1)).toEqual({
      mime: 'video/mp4',
      ext: 'mp4',
    });
    expect(validateAssetUpload('video', 'video/webm', 20 * 1024 * 1024)).toEqual({
      mime: 'video/webm',
      ext: 'webm',
    });
    expect(validateAssetUpload('video', 'video/quicktime', ASSET_VIDEO_MAX_BYTES)).toEqual({
      mime: 'video/quicktime',
      ext: 'mov',
    });
  });

  it('rejects mimes outside the kind whitelist, including heic/heif', () => {
    expectAppError(() => validateAssetUpload('image', 'image/heic', 100), 400, 'VALIDATION_ERROR');
    expectAppError(() => validateAssetUpload('image', 'image/heif', 100), 400, 'VALIDATION_ERROR');
    expectAppError(() => validateAssetUpload('image', 'image/svg+xml', 100), 400, 'VALIDATION_ERROR');
    expectAppError(() => validateAssetUpload('image', 'video/mp4', 100), 400, 'VALIDATION_ERROR');
    expectAppError(() => validateAssetUpload('video', 'image/png', 100), 400, 'VALIDATION_ERROR');
    expectAppError(() => validateAssetUpload('video', 'video/ogg', 100), 400, 'VALIDATION_ERROR');
    expectAppError(() => validateAssetUpload('image', 'application/octet-stream', 100), 400, 'VALIDATION_ERROR');
    expectAppError(() => validateAssetUpload('image', '', 100), 400, 'VALIDATION_ERROR');
  });

  it('rejects empty or non-finite size with 400, oversize with 413', () => {
    expectAppError(() => validateAssetUpload('image', 'image/png', 0), 400, 'VALIDATION_ERROR');
    expectAppError(() => validateAssetUpload('image', 'image/png', -1), 400, 'VALIDATION_ERROR');
    expectAppError(() => validateAssetUpload('image', 'image/png', Number.NaN), 400, 'VALIDATION_ERROR');
    expectAppError(
      () => validateAssetUpload('image', 'image/png', ASSET_IMAGE_MAX_BYTES + 1),
      413,
      'VALIDATION_ERROR',
    );
    expectAppError(
      () => validateAssetUpload('video', 'video/mp4', ASSET_VIDEO_MAX_BYTES + 1),
      413,
      'VALIDATION_ERROR',
    );
    expectAppError(
      () => validateAssetUpload('image', 'image/png', 20 * 1024 * 1024),
      413,
      'VALIDATION_ERROR',
    );
  });
});

describe('assetKeyFor / assetSrcFromKey', () => {
  it('builds users/<userId>/doc-assets/<uuid>.<ext> and asset: src', () => {
    const key = assetKeyFor(USER_ID, 'png', FILE_ID);
    expect(key).toBe(`users/${USER_ID}/doc-assets/${FILE_ID}.png`);
    expect(assetSrcFromKey(key)).toBe(`asset:${key}`);
    expect(isAssetKey(key)).toBe(true);
    expect(isAssetSrc(assetSrcFromKey(key))).toBe(true);

    const generated = assetKeyFor(USER_ID, 'mp4');
    expect(generated).toMatch(
      new RegExp(
        `^users/${USER_ID}/doc-assets/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\\.mp4$`,
      ),
    );
  });
});

describe('isAssetSrc / assetKeyFromSrc', () => {
  it('accepts a well-formed asset: src and strips the scheme', () => {
    const key = `users/${USER_ID}/doc-assets/${FILE_ID}.png`;
    const src = `asset:${key}`;
    expect(isAssetSrc(src)).toBe(true);
    expect(assetKeyFromSrc(src)).toBe(key);
  });

  it('rejects malformed asset srcs', () => {
    expect(isAssetSrc(`asset:users/not-a-uuid/doc-assets/${FILE_ID}.png`)).toBe(false);
    expect(isAssetSrc(`asset:users/${USER_ID}/other/${FILE_ID}.png`)).toBe(false);
    expect(isAssetSrc(`ASSET:users/${USER_ID}/doc-assets/${FILE_ID}.png`)).toBe(false);
    expect(isAssetSrc(`users/${USER_ID}/doc-assets/${FILE_ID}.png`)).toBe(false);
    expectAppError(
      () => assetKeyFromSrc(`asset:users/${USER_ID}/nope/${FILE_ID}.png`),
      400,
      'VALIDATION_ERROR',
    );
  });
});

describe('assertOwnedAssetKey', () => {
  it('accepts a doc-assets key for that user', () => {
    expect(() =>
      assertOwnedAssetKey(USER_ID, `users/${USER_ID}/doc-assets/${FILE_ID}.jpg`),
    ).not.toThrow();
  });

  it('rejects another user, traversal, extra segments, or non-asset keys', () => {
    expectAppError(
      () => assertOwnedAssetKey(USER_ID, `users/${OTHER_ID}/doc-assets/${FILE_ID}.png`),
      400,
      'VALIDATION_ERROR',
    );
    expectAppError(
      () =>
        assertOwnedAssetKey(
          USER_ID,
          `users/${USER_ID}/../${OTHER_ID}/doc-assets/${FILE_ID}.png`,
        ),
      400,
      'VALIDATION_ERROR',
    );
    expectAppError(
      () => assertOwnedAssetKey(USER_ID, `users/${USER_ID}/nested/${FILE_ID}.png`),
      400,
      'VALIDATION_ERROR',
    );
    expectAppError(
      () => assertOwnedAssetKey(USER_ID, `users/${USER_ID}/doc-assets/not-a-uuid.png`),
      400,
      'VALIDATION_ERROR',
    );
    expectAppError(
      () => assertOwnedAssetKey(USER_ID, `avatars/${USER_ID}/${FILE_ID}.png`),
      400,
      'VALIDATION_ERROR',
    );
  });
});

describe('classifyResolveSrc / http(s) passthrough', () => {
  it('passes http(s) through unchanged', () => {
    expect(isHttpSrc('https://example.com/a.png')).toBe(true);
    expect(isHttpSrc('http://cdn.example.com/v.mp4?x=1')).toBe(true);
    expect(isHttpSrc('javascript:alert(1)')).toBe(false);
    expect(isHttpSrc('/relative.png')).toBe(false);

    expect(classifyResolveSrc(USER_ID, 'https://example.com/a.png')).toEqual({
      type: 'http',
      src: 'https://example.com/a.png',
    });
    expect(classifyResolveSrc(USER_ID, 'http://example.com/a.png')).toEqual({
      type: 'http',
      src: 'http://example.com/a.png',
    });
  });

  it('resolves owned asset: srcs to keys and rejects cross-user or illegal srcs', () => {
    const key = `users/${USER_ID}/doc-assets/${FILE_ID}.png`;
    const src = `asset:${key}`;
    expect(classifyResolveSrc(USER_ID, src)).toEqual({ type: 'asset', src, key });

    expectAppError(
      () =>
        classifyResolveSrc(
          USER_ID,
          `asset:users/${OTHER_ID}/doc-assets/${FILE_ID}.png`,
        ),
      400,
      'VALIDATION_ERROR',
    );
    expectAppError(() => classifyResolveSrc(USER_ID, 'javascript:alert(1)'), 400, 'VALIDATION_ERROR');
    expectAppError(
      () => classifyResolveSrc(USER_ID, `/api/v1/uploads/${FILE_ID}`),
      400,
      'VALIDATION_ERROR',
    );
  });

  it('classifies a mixed list and fails the whole batch on one bad src', () => {
    const key = `users/${USER_ID}/doc-assets/${FILE_ID}.webp`;
    const src = `asset:${key}`;
    const https = 'https://cdn.example.com/x.jpg';
    expect(classifyResolveSrcs(USER_ID, [src, https])).toEqual([
      { type: 'asset', src, key },
      { type: 'http', src: https },
    ]);
    expectAppError(
      () =>
        classifyResolveSrcs(USER_ID, [
          https,
          `asset:users/${OTHER_ID}/doc-assets/${FILE_ID}.png`,
        ]),
      400,
      'VALIDATION_ERROR',
    );
  });
});

describe('validateAssetPartNumbers / validateAssetCompleteParts', () => {
  it('sorts unique part numbers and rejects duplicates or empty lists', () => {
    expect(validateAssetPartNumbers([3, 1, 2])).toEqual([1, 2, 3]);
    expectAppError(() => validateAssetPartNumbers([]), 400, 'VALIDATION_ERROR');
    expectAppError(() => validateAssetPartNumbers([1, 1]), 400, 'VALIDATION_ERROR');
    expectAppError(() => validateAssetPartNumbers([0]), 400, 'VALIDATION_ERROR');
  });

  it('requires consecutive parts from 1 and trims etags', () => {
    expect(
      validateAssetCompleteParts([
        { partNumber: 2, etag: ' b ' },
        { partNumber: 1, etag: 'a' },
      ]),
    ).toEqual([
      { partNumber: 1, etag: 'a' },
      { partNumber: 2, etag: 'b' },
    ]);
    expectAppError(
      () => validateAssetCompleteParts([{ partNumber: 2, etag: 'a' }]),
      400,
      'VALIDATION_ERROR',
    );
    expectAppError(
      () => validateAssetCompleteParts([{ partNumber: 1, etag: '  ' }]),
      400,
      'VALIDATION_ERROR',
    );
  });
});
