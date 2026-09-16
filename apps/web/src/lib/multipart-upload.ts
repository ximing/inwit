import type { ImportInitResponse, ImportPartUrl } from '@inwit/dto';
import {
  MULTIPART_CONCURRENCY,
  MULTIPART_PART_ATTEMPTS,
  completedBytes,
  mergeCompletedParts,
  percentComplete,
  readEtagHeader,
  remainingRanges,
  sortedCompleteParts,
  type CompletedPart,
  type ImportCheckpoint,
} from './multipart-logic';

export class UploadAbortedError extends Error {
  constructor() {
    super('Aborted');
    this.name = 'AbortError';
  }
}

export function isAbortError(err: unknown): boolean {
  if (err instanceof UploadAbortedError) return true;
  if (err instanceof DOMException && err.name === 'AbortError') return true;
  return err instanceof Error && err.name === 'AbortError';
}

function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) throw new UploadAbortedError();
}

function wait(ms: number, signal: AbortSignal): Promise<void> {
  if (ms <= 0) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const timer = window.setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      window.clearTimeout(timer);
      reject(new UploadAbortedError());
    };
    if (signal.aborted) {
      window.clearTimeout(timer);
      reject(new UploadAbortedError());
      return;
    }
    signal.addEventListener('abort', onAbort, { once: true });
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
  const runners = Array.from({ length: n }, async () => {
    while (index < items.length) {
      const current = index;
      index += 1;
      const item = items[current];
      if (item === undefined) return;
      await worker(item);
    }
  });
  await Promise.all(runners);
}

function putBlob(
  url: string,
  blob: Blob,
  signal: AbortSignal,
  onProgress: (loaded: number) => void,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    const fail = (err: unknown) => {
      signal.removeEventListener('abort', onAbort);
      reject(err);
    };
    const onAbort = () => {
      xhr.abort();
    };

    xhr.open('PUT', url);
    xhr.onload = () => {
      signal.removeEventListener('abort', onAbort);
      if (xhr.status >= 200 && xhr.status < 300) {
        const etag = readEtagHeader((name) => xhr.getResponseHeader(name));
        if (!etag) {
          reject(new Error('上传分片未返回校验值'));
          return;
        }
        resolve(etag);
        return;
      }
      reject(new Error(`上传分片失败（${xhr.status}）`));
    };
    xhr.onerror = () => fail(new Error('上传分片失败'));
    xhr.onabort = () => fail(new UploadAbortedError());
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) onProgress(event.loaded);
    };

    if (signal.aborted) {
      fail(new UploadAbortedError());
      return;
    }
    signal.addEventListener('abort', onAbort);
    xhr.send(blob);
  });
}

export type UploadPartsDeps = {
  file: File;
  checkpoint: ImportCheckpoint;
  listPartUrls: (partNumbers: number[]) => Promise<ImportPartUrl[]>;
  signal: AbortSignal;
  onCheckpoint: (checkpoint: ImportCheckpoint) => void;
  onProgress: (percent: number) => void;
};

const URL_BATCH = 1000;

export async function uploadRemainingParts(deps: UploadPartsDeps): Promise<CompletedPart[]> {
  const { file, signal } = deps;
  let completed = sortedCompleteParts(deps.checkpoint.parts);
  const inflight = new Map<number, number>();
  const urlByPart = new Map<number, string>();

  const emitProgress = () => {
    let inflightBytes = 0;
    for (const loaded of inflight.values()) inflightBytes += loaded;
    deps.onProgress(percentComplete(completedBytes(completed, file.size) + inflightBytes, file.size));
  };

  const ensureUrls = async (partNumbers: number[]): Promise<void> => {
    const missing = partNumbers.filter((n) => !urlByPart.has(n));
    if (missing.length === 0) return;
    for (let i = 0; i < missing.length; i += URL_BATCH) {
      throwIfAborted(signal);
      const batch = missing.slice(i, i + URL_BATCH);
      const urls = await deps.listPartUrls(batch);
      for (const item of urls) urlByPart.set(item.partNumber, item.url);
    }
  };

  const ranges = remainingRanges(file.size, completed);
  if (ranges.length === 0) {
    deps.onProgress(100);
    return completed;
  }
  const redo = new Set(ranges.map((range) => range.partNumber));
  completed = completed.filter((part) => !redo.has(part.partNumber));

  emitProgress();
  await ensureUrls(ranges.map((range) => range.partNumber));

  await runPool(ranges, MULTIPART_CONCURRENCY, async (range) => {
    throwIfAborted(signal);
    let lastError: unknown;
    for (let attempt = 0; attempt < MULTIPART_PART_ATTEMPTS; attempt += 1) {
      throwIfAborted(signal);
      if (attempt > 0) {
        urlByPart.delete(range.partNumber);
        await wait(250 * attempt, signal);
      }
      try {
        await ensureUrls([range.partNumber]);
        const url = urlByPart.get(range.partNumber);
        if (!url) throw new Error('未取得分片地址');
        const blob = file.slice(range.start, range.endExclusive);
        inflight.set(range.partNumber, 0);
        const etag = await putBlob(url, blob, signal, (loaded) => {
          inflight.set(range.partNumber, loaded);
          emitProgress();
        });
        inflight.delete(range.partNumber);
        completed = mergeCompletedParts(completed, {
          partNumber: range.partNumber,
          etag,
          size: blob.size,
        });
        deps.onCheckpoint({ ...deps.checkpoint, parts: completed });
        emitProgress();
        return;
      } catch (err) {
        inflight.delete(range.partNumber);
        if (isAbortError(err)) throw err;
        lastError = err;
      }
    }
    throw lastError instanceof Error ? lastError : new Error('上传分片失败');
  });

  deps.onProgress(100);
  return sortedCompleteParts(completed);
}

export function checkpointFromInit(
  init: ImportInitResponse,
  file: File,
  parts: CompletedPart[] = [],
): ImportCheckpoint {
  return {
    documentId: init.documentId,
    uploadId: init.uploadId,
    key: init.key,
    filename: file.name,
    size: file.size,
    lastModified: file.lastModified,
    parts,
  };
}
