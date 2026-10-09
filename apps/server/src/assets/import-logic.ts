import {
  ASSET_IMAGE_MAX_BYTES,
  ASSET_VIDEO_MAX_BYTES,
  type AssetKind,
} from '@inwit/dto';
import { AppError } from '../errors.js';
import { assertPublicHttpUrl, isBlockedHostname, isBlockedIp } from '../net/public-url.js';
import {
  ASSET_IMAGE_MIME_TO_EXT,
  ASSET_VIDEO_MIME_TO_EXT,
  normalizeAssetMime,
  type AssetExt,
  type AssetMime,
} from './asset-logic.js';

export { isBlockedHostname, isBlockedIp };

export const ASSET_IMPORT_MAX_REDIRECTS = 3;
export const ASSET_IMPORT_TIMEOUT_MS = 15_000;

export function parseImportUrl(raw: string): URL {
  return assertPublicHttpUrl(raw);
}

export function kindFromMime(contentType: string): { kind: AssetKind; mime: AssetMime; ext: AssetExt } | null {
  const mime = normalizeAssetMime(contentType) as AssetMime;
  if (mime in ASSET_IMAGE_MIME_TO_EXT) {
    return { kind: 'image', mime, ext: ASSET_IMAGE_MIME_TO_EXT[mime as keyof typeof ASSET_IMAGE_MIME_TO_EXT] };
  }
  if (mime in ASSET_VIDEO_MIME_TO_EXT) {
    return { kind: 'video', mime, ext: ASSET_VIDEO_MIME_TO_EXT[mime as keyof typeof ASSET_VIDEO_MIME_TO_EXT] };
  }
  return null;
}

export function sniffAssetMime(bytes: Uint8Array): { kind: AssetKind; mime: AssetMime; ext: AssetExt } | null {
  if (bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) {
    return kindFromMime('image/png');
  }
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return kindFromMime('image/jpeg');
  }
  if (bytes.length >= 6 && bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46) {
    return kindFromMime('image/gif');
  }
  if (
    bytes.length >= 12 &&
    bytes[0] === 0x52 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x46 &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x45 &&
    bytes[10] === 0x42 &&
    bytes[11] === 0x50
  ) {
    return kindFromMime('image/webp');
  }
  if (bytes.length >= 12 && bytes[4] === 0x66 && bytes[5] === 0x74 && bytes[6] === 0x79 && bytes[7] === 0x70) {
    return kindFromMime('video/mp4');
  }
  if (bytes.length >= 4 && bytes[0] === 0x1a && bytes[1] === 0x45 && bytes[2] === 0xdf && bytes[3] === 0xa3) {
    return kindFromMime('video/webm');
  }
  return null;
}

export function classifyImportedBytes(
  contentType: string,
  bytes: Uint8Array,
): { kind: AssetKind; mime: AssetMime; ext: AssetExt } {
  const fromHeader = kindFromMime(contentType);
  const sniffed = sniffAssetMime(bytes);
  const classified = fromHeader ?? sniffed;
  if (!classified) throw AppError.of(400, 'ASSET_IMPORT_FAILED');
  const max = classified.kind === 'image' ? ASSET_IMAGE_MAX_BYTES : ASSET_VIDEO_MAX_BYTES;
  if (bytes.length === 0 || bytes.length > max) throw AppError.of(413, 'VALIDATION_ERROR');
  return classified;
}

/** Cap streaming downloads; unknown types use the video limit then sniff. */
export function importDownloadCap(contentType: string): number {
  const fromHeader = kindFromMime(contentType);
  return fromHeader?.kind === 'image' ? ASSET_IMAGE_MAX_BYTES : ASSET_VIDEO_MAX_BYTES;
}

export async function readResponseBytes(
  res: Response,
  maxBytes: number,
): Promise<Uint8Array> {
  const lengthHeader = res.headers.get('content-length');
  if (lengthHeader) {
    const length = Number(lengthHeader);
    if (Number.isFinite(length) && length > maxBytes) throw AppError.of(413, 'VALIDATION_ERROR');
  }
  const body = res.body;
  if (!body) {
    const buf = new Uint8Array(await res.arrayBuffer());
    if (buf.length > maxBytes) throw AppError.of(413, 'VALIDATION_ERROR');
    return buf;
  }
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      throw AppError.of(413, 'VALIDATION_ERROR');
    }
    chunks.push(value);
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return out;
}
