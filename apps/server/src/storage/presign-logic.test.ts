import { describe, expect, it } from 'vitest';
import { AppError } from '../errors.js';
import {
  AVATAR_MAX_BYTES,
  avatarKeyFor,
  extForAvatarMime,
  isAvatarKeyForUser,
  validateAvatarUpload,
} from './presign-logic.js';

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

describe('extForAvatarMime', () => {
  it('maps the mime whitelist to extensions and strips parameters', () => {
    expect(extForAvatarMime('image/jpeg')).toBe('jpg');
    expect(extForAvatarMime('image/png')).toBe('png');
    expect(extForAvatarMime('image/webp')).toBe('webp');
    expect(extForAvatarMime('IMAGE/JPEG; charset=binary')).toBe('jpg');
  });

  it('rejects types outside the whitelist', () => {
    expectAppError(() => extForAvatarMime('image/gif'), 400, 'VALIDATION_ERROR');
    expectAppError(() => extForAvatarMime('image/jpg'), 400, 'VALIDATION_ERROR');
    expectAppError(() => extForAvatarMime('application/octet-stream'), 400, 'VALIDATION_ERROR');
    expectAppError(() => extForAvatarMime(''), 400, 'VALIDATION_ERROR');
  });
});

describe('validateAvatarUpload', () => {
  it('accepts a whitelist mime within 5MB', () => {
    expect(validateAvatarUpload('image/png', 1)).toEqual({ mime: 'image/png', ext: 'png' });
    expect(validateAvatarUpload('image/webp', AVATAR_MAX_BYTES)).toEqual({
      mime: 'image/webp',
      ext: 'webp',
    });
  });

  it('rejects oversize, empty, or non-finite payloads', () => {
    expectAppError(() => validateAvatarUpload('image/png', 0), 400, 'VALIDATION_ERROR');
    expectAppError(() => validateAvatarUpload('image/png', -1), 400, 'VALIDATION_ERROR');
    expectAppError(
      () => validateAvatarUpload('image/png', AVATAR_MAX_BYTES + 1),
      400,
      'VALIDATION_ERROR',
    );
    expectAppError(() => validateAvatarUpload('image/png', Number.NaN), 400, 'VALIDATION_ERROR');
  });

  it('rejects disallowed mime even when size is valid', () => {
    expectAppError(() => validateAvatarUpload('image/gif', 100), 400, 'VALIDATION_ERROR');
  });
});

describe('avatarKeyFor', () => {
  it('builds avatars/<userId>/<uuid>.<ext>', () => {
    const key = avatarKeyFor(USER_ID, 'image/png', FILE_ID);
    expect(key).toBe(`avatars/${USER_ID}/${FILE_ID}.png`);
    expect(avatarKeyFor(USER_ID, 'image/jpeg', FILE_ID)).toBe(
      `avatars/${USER_ID}/${FILE_ID}.jpg`,
    );

    const generated = avatarKeyFor(USER_ID, 'image/webp');
    expect(generated).toMatch(
      new RegExp(
        `^avatars/${USER_ID}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\\.webp$`,
      ),
    );
  });
});

describe('isAvatarKeyForUser', () => {
  it('accepts a key issued for that user', () => {
    expect(isAvatarKeyForUser(`avatars/${USER_ID}/${FILE_ID}.png`, USER_ID)).toBe(true);
    expect(isAvatarKeyForUser(`avatars/${USER_ID}/${FILE_ID}.jpg`, USER_ID)).toBe(true);
    expect(isAvatarKeyForUser(`avatars/${USER_ID}/${FILE_ID}.webp`, USER_ID)).toBe(true);
  });

  it('rejects another user, traversal, extra segments, or unknown ext', () => {
    expect(isAvatarKeyForUser(`avatars/${OTHER_ID}/${FILE_ID}.png`, USER_ID)).toBe(false);
    expect(isAvatarKeyForUser(`avatars/${USER_ID}/../${OTHER_ID}/${FILE_ID}.png`, USER_ID)).toBe(
      false,
    );
    expect(isAvatarKeyForUser(`avatars/${USER_ID}/nested/${FILE_ID}.png`, USER_ID)).toBe(false);
    expect(isAvatarKeyForUser(`avatars/${USER_ID}/${FILE_ID}.gif`, USER_ID)).toBe(false);
    expect(isAvatarKeyForUser(`avatars/${USER_ID}/${FILE_ID}.jpeg`, USER_ID)).toBe(false);
    expect(isAvatarKeyForUser(`avatars/${USER_ID}`, USER_ID)).toBe(false);
    expect(isAvatarKeyForUser(`avatars/${USER_ID}/not-a-uuid.png`, USER_ID)).toBe(false);
  });
});
