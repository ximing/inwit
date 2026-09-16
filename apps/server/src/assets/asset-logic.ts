import {
  ASSET_IMAGE_MAX_BYTES,
  ASSET_VIDEO_MAX_BYTES,
  type AssetKind,
} from '@inwit/dto';
import { randomUUID } from 'node:crypto';
import { AppError } from '../errors.js';

export const ASSET_IMAGE_MIME_TO_EXT = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
} as const;

export const ASSET_VIDEO_MIME_TO_EXT = {
  'video/mp4': 'mp4',
  'video/webm': 'webm',
  'video/quicktime': 'mov',
} as const;

export type AssetImageMime = keyof typeof ASSET_IMAGE_MIME_TO_EXT;
export type AssetVideoMime = keyof typeof ASSET_VIDEO_MIME_TO_EXT;
export type AssetMime = AssetImageMime | AssetVideoMime;
export type AssetExt =
  | (typeof ASSET_IMAGE_MIME_TO_EXT)[AssetImageMime]
  | (typeof ASSET_VIDEO_MIME_TO_EXT)[AssetVideoMime];

export const S3_MAX_PARTS = 10_000;

const UUID =
  '[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}';
/** `users/<uuid>/doc-assets/<uuid>.<ext>` — matches markdown `asset:` destinations. */
const ASSET_KEY_PATTERN = `users/${UUID}/doc-assets/${UUID}\\.[a-zA-Z0-9]{1,16}`;
const ASSET_KEY_RE = new RegExp(`^${ASSET_KEY_PATTERN}$`);
const ASSET_SRC_RE = new RegExp(`^asset:${ASSET_KEY_PATTERN}$`);

const ASSET_PREFIX = 'asset:';

export type ResolvedHttpSrc = { type: 'http'; src: string };
export type ResolvedAssetSrc = { type: 'asset'; src: string; key: string };
export type ResolvedSrc = ResolvedHttpSrc | ResolvedAssetSrc;

export function normalizeAssetMime(contentType: string): string {
  const raw = contentType.split(';')[0] ?? contentType;
  return raw.trim().toLowerCase();
}

function mimeToExt(kind: AssetKind, mime: string): AssetExt | undefined {
  if (kind === 'image') return ASSET_IMAGE_MIME_TO_EXT[mime as AssetImageMime];
  return ASSET_VIDEO_MIME_TO_EXT[mime as AssetVideoMime];
}

function maxBytesFor(kind: AssetKind): number {
  return kind === 'image' ? ASSET_IMAGE_MAX_BYTES : ASSET_VIDEO_MAX_BYTES;
}

export function validateAssetUpload(
  kind: AssetKind,
  contentType: string,
  sizeBytes: number,
): { mime: AssetMime; ext: AssetExt } {
  if (kind !== 'image' && kind !== 'video') {
    throw AppError.of(400, 'VALIDATION_ERROR');
  }
  if (!Number.isFinite(sizeBytes) || sizeBytes <= 0) {
    throw AppError.of(400, 'VALIDATION_ERROR');
  }
  if (sizeBytes > maxBytesFor(kind)) {
    throw AppError.of(413, 'VALIDATION_ERROR');
  }
  const mime = normalizeAssetMime(contentType);
  const ext = mimeToExt(kind, mime);
  if (!ext) throw AppError.of(400, 'VALIDATION_ERROR');
  return { mime: mime as AssetMime, ext };
}

export function assetKeyFor(userId: string, ext: string, id = randomUUID()): string {
  return `users/${userId}/doc-assets/${id}.${ext}`;
}

export function assetSrcFromKey(key: string): string {
  return `${ASSET_PREFIX}${key}`;
}

export function isAssetSrc(src: string): boolean {
  return ASSET_SRC_RE.test(src);
}

export function isAssetKey(key: string): boolean {
  return ASSET_KEY_RE.test(key);
}

export function assetKeyFromSrc(src: string): string {
  if (!isAssetSrc(src)) throw AppError.of(400, 'VALIDATION_ERROR');
  return src.slice(ASSET_PREFIX.length);
}

export function isHttpSrc(src: string): boolean {
  try {
    const parsed = new URL(src);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

/** Owner check: key must be a doc-asset object under `users/<userId>/`. */
export function assertOwnedAssetKey(userId: string, key: string): void {
  const prefix = `users/${userId}/`;
  if (!isAssetKey(key) || !key.startsWith(prefix) || key.includes('..')) {
    throw AppError.of(400, 'VALIDATION_ERROR');
  }
}

export function classifyResolveSrc(userId: string, src: string): ResolvedSrc {
  if (isAssetSrc(src)) {
    const key = assetKeyFromSrc(src);
    assertOwnedAssetKey(userId, key);
    return { type: 'asset', src, key };
  }
  if (isHttpSrc(src)) return { type: 'http', src };
  throw AppError.of(400, 'VALIDATION_ERROR');
}

export function classifyResolveSrcs(userId: string, srcs: readonly string[]): ResolvedSrc[] {
  return srcs.map((src) => classifyResolveSrc(userId, src));
}

export function validateAssetPartNumbers(partNumbers: number[]): number[] {
  if (partNumbers.length === 0) throw AppError.of(400, 'VALIDATION_ERROR');
  const seen = new Set<number>();
  for (const n of partNumbers) {
    if (!Number.isInteger(n) || n < 1 || n > S3_MAX_PARTS) {
      throw AppError.of(400, 'VALIDATION_ERROR');
    }
    if (seen.has(n)) throw AppError.of(400, 'VALIDATION_ERROR');
    seen.add(n);
  }
  return [...partNumbers].sort((a, b) => a - b);
}

export function validateAssetCompleteParts(
  parts: Array<{ partNumber: number; etag: string }>,
): Array<{ partNumber: number; etag: string }> {
  if (parts.length === 0) throw AppError.of(400, 'VALIDATION_ERROR');
  const seen = new Set<number>();
  const cleaned: Array<{ partNumber: number; etag: string }> = [];
  for (const part of parts) {
    if (!Number.isInteger(part.partNumber) || part.partNumber < 1 || part.partNumber > S3_MAX_PARTS) {
      throw AppError.of(400, 'VALIDATION_ERROR');
    }
    const etag = part.etag.trim();
    if (etag.length === 0) throw AppError.of(400, 'VALIDATION_ERROR');
    if (seen.has(part.partNumber)) throw AppError.of(400, 'VALIDATION_ERROR');
    seen.add(part.partNumber);
    cleaned.push({ partNumber: part.partNumber, etag });
  }
  cleaned.sort((a, b) => a.partNumber - b.partNumber);
  for (let i = 0; i < cleaned.length; i += 1) {
    if (cleaned[i]?.partNumber !== i + 1) throw AppError.of(400, 'VALIDATION_ERROR');
  }
  return cleaned;
}
