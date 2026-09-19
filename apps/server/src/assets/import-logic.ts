import {
  ASSET_IMAGE_MAX_BYTES,
  ASSET_VIDEO_MAX_BYTES,
  type AssetKind,
} from '@inwit/dto';
import { AppError } from '../errors.js';
import {
  ASSET_IMAGE_MIME_TO_EXT,
  ASSET_VIDEO_MIME_TO_EXT,
  normalizeAssetMime,
  type AssetExt,
  type AssetMime,
} from './asset-logic.js';

export const ASSET_IMPORT_MAX_REDIRECTS = 3;
export const ASSET_IMPORT_TIMEOUT_MS = 15_000;

const BLOCKED_HOSTS = new Set(['localhost', 'metadata.google.internal']);

export function isBlockedHostname(host: string): boolean {
  const normalized = host.trim().toLowerCase().replace(/\.$/, '');
  if (!normalized) return true;
  if (BLOCKED_HOSTS.has(normalized)) return true;
  if (normalized.endsWith('.localhost') || normalized.endsWith('.local')) return true;
  return false;
}

export function isBlockedIp(ip: string): boolean {
  const mapped = ipv4FromMapped(ip);
  if (mapped) return isBlockedIpv4(mapped);
  if (ip.includes(':')) return isBlockedIpv6(ip);
  return isBlockedIpv4(ip);
}

export function parseImportUrl(raw: string): URL {
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw AppError.of(400, 'VALIDATION_ERROR');
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw AppError.of(400, 'VALIDATION_ERROR');
  }
  if (parsed.username || parsed.password) throw AppError.of(400, 'ASSET_IMPORT_BLOCKED');
  if (isBlockedHostname(parsed.hostname)) throw AppError.of(400, 'ASSET_IMPORT_BLOCKED');
  if (isIpLiteral(parsed.hostname) && isBlockedIp(stripIpv6Brackets(parsed.hostname))) {
    throw AppError.of(400, 'ASSET_IMPORT_BLOCKED');
  }
  return parsed;
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

function isIpLiteral(host: string): boolean {
  const bare = stripIpv6Brackets(host);
  return /^\d{1,3}(?:\.\d{1,3}){3}$/.test(bare) || bare.includes(':');
}

function stripIpv6Brackets(host: string): string {
  if (host.startsWith('[') && host.endsWith(']')) return host.slice(1, -1);
  return host;
}

function ipv4FromMapped(ip: string): string | null {
  const lower = ip.toLowerCase();
  const prefix = '::ffff:';
  if (lower.startsWith(prefix)) return ip.slice(prefix.length);
  return null;
}

function isBlockedIpv4(ip: string): boolean {
  const parts = ip.split('.').map((part) => Number(part));
  if (parts.length !== 4 || parts.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return true;
  const [a, b] = parts as [number, number, number, number];
  if (a === 0 || a === 10 || a === 127) return true;
  if (a === 169 && b === 254) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a >= 224) return true;
  return false;
}

function isBlockedIpv6(ip: string): boolean {
  const lower = ip.toLowerCase();
  if (lower === '::1' || lower === '::') return true;
  const first = ipv6First16(lower);
  if (first == null) return true;
  if ((first & 0xfe00) === 0xfc00) return true;
  if ((first & 0xffc0) === 0xfe80) return true;
  if (first === 0xff00) return true;
  return false;
}

function ipv6First16(ip: string): number | null {
  const head = ip.split(':')[0];
  if (!head) return ip.startsWith('::') ? 0 : null;
  const value = Number.parseInt(head, 16);
  return Number.isFinite(value) ? value : null;
}
