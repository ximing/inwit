/** S3 multipart minimum part size (except the last part). */
export const MULTIPART_PART_SIZE = 5 * 1024 * 1024;
export const MULTIPART_MAX_PARTS = 10_000;
export const MULTIPART_CONCURRENCY = 3;
export const MULTIPART_PART_ATTEMPTS = 3;

export const IMPORT_CHECKPOINT_STORAGE_KEY = 'inwit.import.checkpoints';

export type ByteRange = {
  partNumber: number;
  start: number;
  endExclusive: number;
};

export type CompletedPart = {
  partNumber: number;
  etag: string;
};

export type ImportCheckpoint = {
  documentId: string;
  uploadId: string;
  key: string;
  filename: string;
  size: number;
  parts: CompletedPart[];
};

export type CheckpointStore = {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
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
  const done = new Set(completed.map((part) => part.partNumber));
  return sliceRanges(size, partSize).filter((range) => !done.has(range.partNumber));
}

export function mergeCompletedParts(
  existing: readonly CompletedPart[],
  incoming: CompletedPart,
): CompletedPart[] {
  const next = existing.filter((part) => part.partNumber !== incoming.partNumber);
  next.push({ partNumber: incoming.partNumber, etag: incoming.etag.trim() });
  next.sort((a, b) => a.partNumber - b.partNumber);
  return next;
}

export function sortedCompleteParts(parts: readonly CompletedPart[]): CompletedPart[] {
  return [...parts]
    .map((part) => ({ partNumber: part.partNumber, etag: part.etag.trim() }))
    .filter((part) => Number.isInteger(part.partNumber) && part.partNumber > 0 && part.etag.length > 0)
    .sort((a, b) => a.partNumber - b.partNumber);
}

export function readEtagHeader(getHeader: (name: string) => string | null): string | null {
  const raw = getHeader('etag') ?? getHeader('ETag');
  if (!raw) return null;
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function isCompletedPart(value: unknown): value is CompletedPart {
  if (typeof value !== 'object' || value === null) return false;
  const part = value as { partNumber?: unknown; etag?: unknown };
  return (
    typeof part.partNumber === 'number' &&
    Number.isInteger(part.partNumber) &&
    part.partNumber > 0 &&
    typeof part.etag === 'string' &&
    part.etag.trim().length > 0
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
    if (!isCompletedPart(item)) return null;
    parts.push({ partNumber: item.partNumber, etag: item.etag.trim() });
  }
  return {
    documentId: raw.documentId,
    uploadId: raw.uploadId,
    key: raw.key,
    filename: raw.filename,
    size: raw.size,
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
): ImportCheckpoint | null {
  return items.find((item) => item.filename === filename && item.size === size) ?? null;
}

function memoryStore(): CheckpointStore {
  return {
    getItem: () => null,
    setItem: () => undefined,
    removeItem: () => undefined,
  };
}

export function defaultCheckpointStore(): CheckpointStore {
  try {
    if (typeof globalThis.localStorage === 'undefined') return memoryStore();
    return globalThis.localStorage;
  } catch {
    return memoryStore();
  }
}

export function loadCheckpoints(store: CheckpointStore = defaultCheckpointStore()): ImportCheckpoint[] {
  return parseCheckpointList(store.getItem(IMPORT_CHECKPOINT_STORAGE_KEY));
}

export function saveCheckpoints(
  items: readonly ImportCheckpoint[],
  store: CheckpointStore = defaultCheckpointStore(),
): void {
  if (items.length === 0) {
    store.removeItem(IMPORT_CHECKPOINT_STORAGE_KEY);
    return;
  }
  store.setItem(IMPORT_CHECKPOINT_STORAGE_KEY, serializeCheckpointList(items));
}

export function upsertCheckpoint(
  checkpoint: ImportCheckpoint,
  store: CheckpointStore = defaultCheckpointStore(),
): ImportCheckpoint {
  const next = loadCheckpoints(store).filter((item) => item.documentId !== checkpoint.documentId);
  next.push(checkpoint);
  saveCheckpoints(next, store);
  return checkpoint;
}

export function removeCheckpoint(
  documentId: string,
  store: CheckpointStore = defaultCheckpointStore(),
): void {
  const next = loadCheckpoints(store).filter((item) => item.documentId !== documentId);
  saveCheckpoints(next, store);
}

export function findCheckpoint(
  documentId: string,
  store: CheckpointStore = defaultCheckpointStore(),
): ImportCheckpoint | null {
  return loadCheckpoints(store).find((item) => item.documentId === documentId) ?? null;
}

export function findCheckpointForFile(
  filename: string,
  size: number,
  store: CheckpointStore = defaultCheckpointStore(),
): ImportCheckpoint | null {
  return matchCheckpoint(loadCheckpoints(store), filename, size);
}
