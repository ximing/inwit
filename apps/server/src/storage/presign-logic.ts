import { randomUUID } from 'node:crypto';
import { AppError } from '../errors.js';

export const AVATAR_MAX_BYTES = 5 * 1024 * 1024;

export const AVATAR_MIME_TO_EXT = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
} as const;

export type AvatarMime = keyof typeof AVATAR_MIME_TO_EXT;
export type AvatarExt = (typeof AVATAR_MIME_TO_EXT)[AvatarMime];

const AVATAR_KEY_FILE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(jpg|png|webp)$/i;

export function normalizeMime(contentType: string): string {
  const raw = contentType.split(';')[0] ?? contentType;
  return raw.trim().toLowerCase();
}

export function extForAvatarMime(contentType: string): AvatarExt {
  const mime = normalizeMime(contentType);
  const ext = AVATAR_MIME_TO_EXT[mime as AvatarMime];
  if (!ext) throw AppError.of(400, 'VALIDATION_ERROR');
  return ext;
}

export function validateAvatarUpload(
  contentType: string,
  sizeBytes: number,
): { mime: string; ext: AvatarExt } {
  if (!Number.isFinite(sizeBytes) || sizeBytes <= 0 || sizeBytes > AVATAR_MAX_BYTES) {
    throw AppError.of(400, 'VALIDATION_ERROR');
  }
  const mime = normalizeMime(contentType);
  const ext = AVATAR_MIME_TO_EXT[mime as AvatarMime];
  if (!ext) throw AppError.of(400, 'VALIDATION_ERROR');
  return { mime, ext };
}

export function avatarKeyFor(userId: string, contentType: string, id = randomUUID()): string {
  const ext = extForAvatarMime(contentType);
  return `avatars/${userId}/${id}.${ext}`;
}

export function isAvatarKeyForUser(key: string, userId: string): boolean {
  const prefix = `avatars/${userId}/`;
  if (!key.startsWith(prefix)) return false;
  const rest = key.slice(prefix.length);
  if (rest.includes('/') || rest.includes('..')) return false;
  return AVATAR_KEY_FILE.test(rest);
}
