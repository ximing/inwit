import { File, FileMode } from 'expo-file-system';
import {
  MULTIPART_MAX_PARTS,
  completedBytes,
  mergeCompletedParts,
  partCountForSize,
  percentComplete,
  readEtagHeader,
  remainingRanges,
  sortedCompleteParts,
  type CompletedPart,
} from './import-logic';

const PART_ATTEMPTS = 3;
const PART_CONCURRENCY = 3;
const URL_BATCH = 100;

export class UploadAbortedError extends Error {
  constructor() {
    super('Aborted');
    this.name = 'AbortError';
  }
}

export type PartUrl = { partNumber: number; url: string };

export type UploadPartsDeps = {
  uri: string;
  size: number;
  completed: readonly CompletedPart[];
  signal: AbortSignal;
  listPartUrls: (partNumbers: number[]) => Promise<PartUrl[]>;
  onCheckpoint: (parts: CompletedPart[]) => void;
  onProgress: (percent: number) => void;
};

function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) throw new UploadAbortedError();
}

function wait(ms: number, signal: AbortSignal): Promise<void> {
  if (ms <= 0) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(new UploadAbortedError());
    };
    if (signal.aborted) {
      clearTimeout(timer);
      reject(new UploadAbortedError());
      return;
    }
    signal.addEventListener('abort', onAbort);
  });
}

async function runPool<T>(
  items: readonly T[],
  limit: number,
  worker: (item: T) => Promise<void>,
): Promise<void> {
  if (items.length === 0) return;
  let index = 0;
  const n = Math.max(1, Math.min(limit, items.length));
  await Promise.all(
    Array.from({ length: n }, async () => {
      while (index < items.length) {
        const current = index;
        index += 1;
        const item = items[current];
        if (item === undefined) return;
        await worker(item);
      }
    }),
  );
}

/** Reads one part without loading the rest of the file. */
export function readByteRange(uri: string, start: number, length: number): Uint8Array<ArrayBuffer> {
  const file = new File(uri);
  const handle = file.open(FileMode.ReadOnly);
  try {
    handle.offset = start;
    const bytes = handle.readBytes(length);
    if (bytes.byteLength !== length) throw new Error('读不到完整的分片');
    const copy = new Uint8Array(new ArrayBuffer(bytes.byteLength));
    copy.set(bytes);
    return copy;
  } finally {
    handle.close();
  }
}

function etagFrom(headers: Headers): string | null {
  return readEtagHeader((name) => headers.get(name));
}

async function putPart(url: string, bytes: Uint8Array<ArrayBuffer>, signal: AbortSignal): Promise<string> {
  throwIfAborted(signal);
  const response = await fetch(url, {
    method: 'PUT',
    body: bytes,
    signal,
  });
  if (!response.ok) throw new Error(`上传分片失败（${response.status}）`);
  const etag = etagFrom(response.headers);
  if (!etag) throw new Error('上传分片未返回校验值');
  return etag;
}

export async function uploadRemainingParts(deps: UploadPartsDeps): Promise<CompletedPart[]> {
  const { signal, size } = deps;
  if (partCountForSize(size) > MULTIPART_MAX_PARTS) throw new Error('文件太大了');
  let completed = sortedCompleteParts(deps.completed);
  const ranges = remainingRanges(size, completed);
  if (ranges.length === 0) {
    deps.onProgress(100);
    return completed;
  }
  const redo = new Set(ranges.map((range) => range.partNumber));
  completed = completed.filter((part) => !redo.has(part.partNumber));
  deps.onProgress(percentComplete(completedBytes(completed, size), size));

  const urlByPart = new Map<number, string>();
  const ensureUrls = async (partNumbers: number[]): Promise<void> => {
    const missing = partNumbers.filter((partNumber) => !urlByPart.has(partNumber));
    for (let i = 0; i < missing.length; i += URL_BATCH) {
      throwIfAborted(signal);
      const batch = missing.slice(i, i + URL_BATCH);
      const urls = await deps.listPartUrls(batch);
      for (const item of urls) urlByPart.set(item.partNumber, item.url);
    }
  };
  await ensureUrls(ranges.map((range) => range.partNumber));

  let failure: unknown = null;
  await runPool(ranges, PART_CONCURRENCY, async (range) => {
    if (failure || signal.aborted) return;
    let lastError: unknown;
    for (let attempt = 0; attempt < PART_ATTEMPTS; attempt += 1) {
      if (failure || signal.aborted) return;
      if (attempt > 0) {
        urlByPart.delete(range.partNumber);
        try {
          await wait(250 * attempt, signal);
        } catch (err) {
          failure = err;
          return;
        }
      }
      try {
        await ensureUrls([range.partNumber]);
        const url = urlByPart.get(range.partNumber);
        if (!url) throw new Error('未取得分片地址');
        const length = range.endExclusive - range.start;
        const bytes = readByteRange(deps.uri, range.start, length);
        const etag = await putPart(url, bytes, signal);
        completed = mergeCompletedParts(completed, {
          partNumber: range.partNumber,
          etag,
          size: length,
        });
        deps.onCheckpoint(completed);
        deps.onProgress(percentComplete(completedBytes(completed, size), size));
        return;
      } catch (err) {
        if (signal.aborted || (err instanceof Error && err.name === 'AbortError')) {
          failure = err;
          return;
        }
        lastError = err;
      }
    }
    failure = lastError instanceof Error ? lastError : new Error('上传分片失败');
  });

  if (signal.aborted || (failure instanceof Error && failure.name === 'AbortError')) {
    throw new UploadAbortedError();
  }
  if (failure) throw failure;
  deps.onProgress(100);
  return sortedCompleteParts(completed);
}

export function byteSizeOf(uri: string, hinted?: number | null): number {
  if (typeof hinted === 'number' && Number.isFinite(hinted) && hinted > 0) return hinted;
  try {
    const file = new File(uri);
    return file.exists ? file.size : 0;
  } catch {
    return 0;
  }
}
