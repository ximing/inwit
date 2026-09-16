import { SCREENSHOT_MAX_BYTES, SCREENSHOT_MIMES, type ScreenshotMime } from '@inwit/dto';
import { AppError } from '../errors.js';

export const SCREENSHOT_MIME_TO_EXT = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
} as const;

export type ScreenshotExt = (typeof SCREENSHOT_MIME_TO_EXT)[ScreenshotMime];

export function normalizeScreenshotMime(contentType: string): string {
  const raw = contentType.split(';')[0] ?? contentType;
  return raw.trim().toLowerCase();
}

export function isOcrImageMime(mime: string | null | undefined): boolean {
  if (!mime) return false;
  const normalized = normalizeScreenshotMime(mime);
  return (SCREENSHOT_MIMES as readonly string[]).includes(normalized);
}

export function validateScreenshotUpload(
  contentType: string,
  sizeBytes: number,
): { mime: ScreenshotMime; ext: ScreenshotExt } {
  if (!Number.isFinite(sizeBytes) || sizeBytes <= 0 || sizeBytes > SCREENSHOT_MAX_BYTES) {
    throw AppError.of(400, 'VALIDATION_ERROR');
  }
  const mime = normalizeScreenshotMime(contentType);
  const ext = SCREENSHOT_MIME_TO_EXT[mime as ScreenshotMime];
  if (!ext) throw AppError.of(400, 'VALIDATION_ERROR');
  return { mime: mime as ScreenshotMime, ext };
}

export function screenshotSourceKey(
  userId: string,
  documentId: string,
  ext: ScreenshotExt,
): string {
  return `docs/${userId}/${documentId}/source.${ext}`;
}

export function isScreenshotSourceKey(key: string, userId: string, documentId: string): boolean {
  const prefix = `docs/${userId}/${documentId}/source.`;
  if (!key.startsWith(prefix) || key.includes('..')) return false;
  const ext = key.slice(prefix.length);
  return ext === 'png' || ext === 'jpg' || ext === 'webp';
}

export function screenshotExtFromKey(key: string): ScreenshotExt | null {
  if (key.endsWith('.png')) return 'png';
  if (key.endsWith('.jpg')) return 'jpg';
  if (key.endsWith('.webp')) return 'webp';
  return null;
}

export function defaultScreenshotTitle(now = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `截图 ${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}`;
}

export function scaleToPixelBudget(
  width: number,
  height: number,
  maxPixels: number,
): { width: number; height: number } {
  const w = Math.max(1, Math.floor(width));
  const h = Math.max(1, Math.floor(height));
  const pixels = w * h;
  if (pixels <= maxPixels) return { width: w, height: h };
  const scale = Math.sqrt(maxPixels / pixels);
  return {
    width: Math.max(1, Math.floor(w * scale)),
    height: Math.max(1, Math.floor(h * scale)),
  };
}
