import { EXCERPT_MAX_BYTES } from '@inwit/dto';
import { randomUUID } from 'node:crypto';
import { AppError } from '../errors.js';

export const EXCERPT_MIME_TO_EXT = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
} as const;

export type ExcerptMime = keyof typeof EXCERPT_MIME_TO_EXT;
export type ExcerptExt = (typeof EXCERPT_MIME_TO_EXT)[ExcerptMime];

const UUID_FILE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(png|jpg|webp)$/i;

export function normalizeExcerptMime(contentType: string): string {
  const raw = contentType.split(';')[0] ?? contentType;
  return raw.trim().toLowerCase();
}

export function validateExcerptMime(contentType: string): { mime: ExcerptMime; ext: ExcerptExt } {
  const mime = normalizeExcerptMime(contentType);
  const ext = EXCERPT_MIME_TO_EXT[mime as ExcerptMime];
  if (!ext) throw AppError.of(400, 'VALIDATION_ERROR');
  return { mime: mime as ExcerptMime, ext };
}

export function validateExcerptUpload(
  contentType: string,
  sizeBytes: number,
): { mime: ExcerptMime; ext: ExcerptExt } {
  if (!Number.isFinite(sizeBytes) || sizeBytes <= 0 || sizeBytes > EXCERPT_MAX_BYTES) {
    throw AppError.of(400, 'VALIDATION_ERROR');
  }
  return validateExcerptMime(contentType);
}

export function excerptKeyFor(
  userId: string,
  documentId: string,
  contentType: string,
  id = randomUUID(),
): string {
  const { ext } = validateExcerptMime(contentType);
  return `docs/${userId}/${documentId}/excerpts/${id}.${ext}`;
}

export function isExcerptKeyFor(
  key: string,
  userId: string,
  documentId: string,
): boolean {
  const prefix = `docs/${userId}/${documentId}/excerpts/`;
  if (!key.startsWith(prefix) || key.includes('..')) return false;
  const rest = key.slice(prefix.length);
  if (rest.includes('/')) return false;
  return UUID_FILE.test(rest);
}
