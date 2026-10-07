/**
 * PDF 文件字节缓存。存储端只签短期 presigned URL，远端带宽有限（实测可低至几十 KB/s），
 * 重复打开同一份 PDF 都重新下载非常慢。这里在 Cache API 里按「文档 id + 版本」缓存字节，
 * 二次打开（含刷新页面后）直接命中本地，打开动作只剩引擎解析。
 * 下载过程带进度回调，慢速链路下用户能看到实打实的百分比。
 */

const CACHE_NAME = 'inwit-pdf-v1';
const MAX_ENTRIES = 12;

export type PdfFileProgress = (loaded: number, total: number | null) => void;

type PdfFileHandle = {
  /** 可直接交给 PDF 引擎的 blob: object URL */
  url: string;
  mime: string;
  fromCache: boolean;
};

const inflight = new Map<string, Promise<PdfFileHandle>>();

function cacheKey(documentId: string, version: string): string {
  return `https://pdf-cache.inwit.local/${documentId}?v=${encodeURIComponent(version)}`;
}

async function trimCache(cache: Cache): Promise<void> {
  const keys = await cache.keys();
  for (const req of keys.slice(0, Math.max(0, keys.length - MAX_ENTRIES))) {
    await cache.delete(req);
  }
}

async function fetchWithProgress(sourceUrl: string, onProgress: PdfFileProgress): Promise<Blob> {
  const res = await fetch(sourceUrl);
  if (!res.ok || !res.body) throw new Error(`文档下载失败（${res.status}）`);
  const totalHeader = Number(res.headers.get('content-length'));
  const total = Number.isFinite(totalHeader) && totalHeader > 0 ? totalHeader : null;
  const reader = res.body.getReader();
  const chunks: BlobPart[] = [];
  let loaded = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    loaded += value.byteLength;
    onProgress(loaded, total);
  }
  return new Blob(chunks, { type: res.headers.get('content-type') ?? 'application/pdf' });
}

export function openPdfFile(input: {
  documentId: string;
  /** 内容版本（updatedAt），字节变化即换缓存键 */
  version: string;
  sourceUrl: string;
  mime: string;
  onProgress?: PdfFileProgress;
}): Promise<PdfFileHandle> {
  const key = `${input.documentId}@${input.version}`;
  const existing = inflight.get(key);
  if (existing) return existing;

  const task = (async (): Promise<PdfFileHandle> => {
    const report = input.onProgress ?? (() => undefined);
    if ('caches' in window) {
      try {
        const cache = await caches.open(CACHE_NAME);
        const hit = await cache.match(cacheKey(input.documentId, input.version));
        if (hit) {
          const blob = await hit.blob();
          return { url: URL.createObjectURL(blob), mime: input.mime, fromCache: true };
        }
        const blob = await fetchWithProgress(input.sourceUrl, report);
        await cache.put(
          cacheKey(input.documentId, input.version),
          new Response(blob, { headers: { 'content-type': input.mime } }),
        );
        void trimCache(cache);
        return { url: URL.createObjectURL(blob), mime: input.mime, fromCache: false };
      } catch (err) {
        // 下载本身的错误向外抛；缓存不可用（隐私模式等）回落直连
        if (err instanceof Error && err.message.startsWith('文档下载失败')) throw err;
      }
    }
    const blob = await fetchWithProgress(input.sourceUrl, report);
    return { url: URL.createObjectURL(blob), mime: input.mime, fromCache: false };
  })();

  inflight.set(key, task);
  void task.finally(() => {
    inflight.delete(key);
  });
  return task;
}
