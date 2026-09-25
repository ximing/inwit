import { FORMAT_BY_EXT, MIME_BY_FORMAT, MULTIPART_PART_SIZE, SCREENSHOT_MIMES, type ImportFormat, type ScreenshotMime } from '@inwit/dto';

export { MULTIPART_PART_SIZE };
export const MULTIPART_MAX_PARTS = 10_000;
export const IMPORT_CHECKPOINT_STORAGE_KEY = 'inwit.import.checkpoints';

const SCREENSHOT_MIME_SET = new Set<string>(SCREENSHOT_MIMES);

export type ByteRange = {
  partNumber: number;
  start: number;
  endExclusive: number;
};

export type CompletedPart = {
  partNumber: number;
  etag: string;
  size: number;
};

export type ImportCheckpoint = {
  documentId: string;
  uploadId: string;
  key: string;
  filename: string;
  size: number;
  /** Distinguishes same-name files so a retry resumes the right upload. */
  lastModified?: number;
  parts: CompletedPart[];
};

export function partCountForSize(size: number, partSize = MULTIPART_PART_SIZE): number {
  if (!Number.isFinite(size) || size <= 0) return 0;
  if (!Number.isFinite(partSize) || partSize <= 0) return 0;
  return Math.ceil(size / partSize);
}

export function sliceRanges(size: number, partSize = MULTIPART_PART_SIZE): ByteRange[] {
  const count = partCountForSize(size, partSize);
  if (count <= 0 || count > MULTIPART_MAX_PARTS) return [];
  const ranges: ByteRange[] = [];
  for (let i = 0; i < count; i += 1) {
    const start = i * partSize;
    ranges.push({
      partNumber: i + 1,
      start,
      endExclusive: Math.min(start + partSize, size),
    });
  }
  return ranges;
}

export function rangeForPart(
  partNumber: number,
  size: number,
  partSize = MULTIPART_PART_SIZE,
): ByteRange | null {
  if (!Number.isInteger(partNumber) || partNumber < 1) return null;
  const start = (partNumber - 1) * partSize;
  if (start >= size) return null;
  return { partNumber, start, endExclusive: Math.min(start + partSize, size) };
}

export function completedBytes(
  parts: readonly CompletedPart[],
  size: number,
  partSize = MULTIPART_PART_SIZE,
): number {
  let bytes = 0;
  for (const part of parts) {
    if (Number.isInteger(part.size) && part.size > 0) {
      bytes += part.size;
      continue;
    }
    const range = rangeForPart(part.partNumber, size, partSize);
    if (!range) continue;
    bytes += range.endExclusive - range.start;
  }
  return bytes;
}

export function percentComplete(bytes: number, size: number): number {
  if (!Number.isFinite(bytes) || !Number.isFinite(size) || size <= 0) return 0;
  return Math.min(100, Math.max(0, Math.round((bytes / size) * 100)));
}

export function checkpointPercent(checkpoint: ImportCheckpoint): number {
  return percentComplete(completedBytes(checkpoint.parts, checkpoint.size), checkpoint.size);
}

export function remainingRanges(
  size: number,
  completed: readonly CompletedPart[],
  partSize = MULTIPART_PART_SIZE,
): ByteRange[] {
  const ranges = sliceRanges(size, partSize);
  const expectedByPart = new Map(
    ranges.map((range) => [range.partNumber, range.endExclusive - range.start] as const),
  );
  const done = new Set<number>();
  for (const part of completed) {
    if (part.size === expectedByPart.get(part.partNumber)) done.add(part.partNumber);
  }
  return ranges.filter((range) => !done.has(range.partNumber));
}

export function mergeCompletedParts(
  existing: readonly CompletedPart[],
  incoming: CompletedPart,
): CompletedPart[] {
  const next = existing.filter((part) => part.partNumber !== incoming.partNumber);
  next.push({ partNumber: incoming.partNumber, etag: incoming.etag.trim(), size: incoming.size });
  next.sort((a, b) => a.partNumber - b.partNumber);
  return next;
}

export function sortedCompleteParts(parts: readonly CompletedPart[]): CompletedPart[] {
  return [...parts]
    .map((part) => ({ partNumber: part.partNumber, etag: part.etag.trim(), size: part.size }))
    .filter(
      (part) =>
        Number.isInteger(part.partNumber) &&
        part.partNumber > 0 &&
        part.etag.length > 0 &&
        Number.isInteger(part.size) &&
        part.size > 0,
    )
    .sort((a, b) => a.partNumber - b.partNumber);
}

/** Keeps the trimmed header, including quotes. */
export function readEtagHeader(getHeader: (name: string) => string | null): string | null {
  const raw = getHeader('etag') ?? getHeader('ETag');
  if (!raw) return null;
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function isCompletedPart(value: unknown): value is CompletedPart {
  if (typeof value !== 'object' || value === null) return false;
  const part = value as { partNumber?: unknown; etag?: unknown; size?: unknown };
  return (
    typeof part.partNumber === 'number' &&
    Number.isInteger(part.partNumber) &&
    part.partNumber > 0 &&
    typeof part.etag === 'string' &&
    part.etag.trim().length > 0 &&
    typeof part.size === 'number' &&
    Number.isInteger(part.size) &&
    part.size > 0
  );
}

export function parseCheckpoint(value: unknown): ImportCheckpoint | null {
  if (typeof value !== 'object' || value === null) return null;
  const raw = value as Record<string, unknown>;
  if (typeof raw.documentId !== 'string' || raw.documentId.length === 0) return null;
  if (typeof raw.uploadId !== 'string' || raw.uploadId.length === 0) return null;
  if (typeof raw.key !== 'string' || raw.key.length === 0) return null;
  if (typeof raw.filename !== 'string' || raw.filename.length === 0) return null;
  if (typeof raw.size !== 'number' || !Number.isFinite(raw.size) || raw.size <= 0) return null;
  if (!Array.isArray(raw.parts)) return null;
  const parts: CompletedPart[] = [];
  for (const item of raw.parts) {
    if (!isCompletedPart(item)) continue;
    parts.push({ partNumber: item.partNumber, etag: item.etag.trim(), size: item.size });
  }
  const lastModified =
    typeof raw.lastModified === 'number' && Number.isFinite(raw.lastModified)
      ? raw.lastModified
      : undefined;
  return {
    documentId: raw.documentId,
    uploadId: raw.uploadId,
    key: raw.key,
    filename: raw.filename,
    size: raw.size,
    ...(lastModified !== undefined ? { lastModified } : {}),
    parts: sortedCompleteParts(parts),
  };
}

export function parseCheckpointList(text: string | null): ImportCheckpoint[] {
  if (!text) return [];
  try {
    const parsed: unknown = JSON.parse(text);
    if (!Array.isArray(parsed)) return [];
    const items: ImportCheckpoint[] = [];
    const seen = new Set<string>();
    for (const item of parsed) {
      const checkpoint = parseCheckpoint(item);
      if (!checkpoint || seen.has(checkpoint.documentId)) continue;
      seen.add(checkpoint.documentId);
      items.push(checkpoint);
    }
    return items;
  } catch {
    return [];
  }
}

export function serializeCheckpointList(items: readonly ImportCheckpoint[]): string {
  return JSON.stringify(items);
}

export function matchCheckpoint(
  items: readonly ImportCheckpoint[],
  filename: string,
  size: number,
  lastModified: number,
): ImportCheckpoint | null {
  return (
    items.find(
      (item) => item.filename === filename && item.size === size && item.lastModified === lastModified,
    ) ?? null
  );
}

/** Resume only when filename, size, and mtime all match. A same-size rewrite is a different file. */
export function findResumeCheckpoint(
  items: readonly ImportCheckpoint[],
  filename: string,
  size: number,
  lastModified: number,
): ImportCheckpoint | null {
  return matchCheckpoint(items, filename, size, lastModified);
}

export function upsertCheckpointList(
  items: readonly ImportCheckpoint[],
  checkpoint: ImportCheckpoint,
): ImportCheckpoint[] {
  return [...items.filter((item) => item.documentId !== checkpoint.documentId), checkpoint];
}

export function removeCheckpointFromList(
  items: readonly ImportCheckpoint[],
  documentId: string,
): ImportCheckpoint[] {
  return items.filter((item) => item.documentId !== documentId);
}

export function fileExtension(name: string): string {
  const base = name.split(/[/\\]/).pop() ?? name;
  const dot = base.lastIndexOf('.');
  if (dot <= 0) return '';
  return base.slice(dot + 1).toLowerCase();
}

export function importFormatOf(filename: string): ImportFormat | null {
  const ext = fileExtension(filename);
  if (!ext) return null;
  return FORMAT_BY_EXT[ext] ?? null;
}

export function importMime(filename: string, mimeType?: string | null): string {
  const fromFile = (mimeType ?? '').split(';')[0]?.trim() ?? '';
  if (fromFile.length > 0 && fromFile !== 'application/octet-stream') return fromFile;
  const format = importFormatOf(filename);
  return format ? MIME_BY_FORMAT[format] : 'application/octet-stream';
}

type CodedError = { status: number; code: string; message: string };

function asCodedError(err: unknown): CodedError | null {
  if (typeof err !== 'object' || err === null) return null;
  const value = err as { status?: unknown; code?: unknown; message?: unknown };
  if (typeof value.status !== 'number' || typeof value.code !== 'string') return null;
  return {
    status: value.status,
    code: value.code,
    message: typeof value.message === 'string' ? value.message : '',
  };
}

export function importFailMessage(err: unknown): string {
  const coded = asCodedError(err);
  if (coded) {
    if (coded.status === 415 || coded.code === 'IMPORT_UNSUPPORTED_TYPE') {
      return '不支持这种文件。目前可以导入 PDF、Word、EPUB、TXT 和 Markdown';
    }
    if (coded.status === 413) return '文件太大了';
    if (coded.code === 'STORAGE_NOT_CONFIGURED') return '文件存储还没配好';
    if (coded.code === 'DOCUMENT_NOT_RETRYABLE') return '这篇现在不能重试';
    if (coded.code === 'IMPORT_EMPTY') return '这个文件里没有可提取的文字';
    if (coded.code === 'IMPORT_PARTS_MISMATCH') return '分片不完整，请重新上传';
    if (coded.status === 422 || coded.code === 'IMPORT_PARSE_FAILED') {
      return '这个文件解析失败了，可能已加密或损坏';
    }
    if (coded.message.length > 0) return coded.message;
  }
  if (err instanceof Error && err.message) return err.message;
  return '导入失败';
}

export function isAbortError(err: unknown): boolean {
  return err instanceof Error && err.name === 'AbortError';
}

/** png / jpeg / webp only. Empty and HEIC stay null so the caller can stop. */
export function screenshotContentType(mimeType: string | null | undefined): ScreenshotMime | null {
  const mime = (mimeType ?? '').split(';')[0]?.trim().toLowerCase() ?? '';
  if (mime.length === 0) return null;
  if (mime === 'image/jpg') return 'image/jpeg';
  if (SCREENSHOT_MIME_SET.has(mime)) return mime as ScreenshotMime;
  return null;
}
