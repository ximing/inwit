import type { PdfEngine } from '@embedpdf/models';
import wasmUrl from '@embedpdf/pdfium/pdfium.wasm?url';
import { toAbsoluteUrl } from './wasm-url-logic';

/**
 * 全局共享的 pdfium 引擎。usePdfiumEngine 每次挂载都新建 worker + 编译 wasm、
 * 卸载即销毁，导致每开一份 PDF 都重来一遍（秒级）。引擎与具体文档无关，
 * 提升为模块级单例：首次创建后常驻，之后打开/切换 PDF 不再重复引擎开销。
 * 创建失败时清空缓存，下次调用重试。
 */
let enginePromise: Promise<PdfEngine<Blob>> | null = null;

export function sharedPdfiumEngine(): Promise<PdfEngine<Blob>> {
  if (!enginePromise) {
    const url = toAbsoluteUrl(wasmUrl);
    enginePromise = import('@embedpdf/engines/pdfium-worker-engine').then((mod) =>
      mod.createPdfiumEngine(url, { fontFallback: null }),
    );
    enginePromise.catch(() => {
      enginePromise = null;
    });
  }
  return enginePromise;
}

/** 提前点火（列表行悬停预取时调用），等用户点开时引擎已就绪。 */
export function warmPdfEngine(): void {
  void sharedPdfiumEngine().catch(() => undefined);
}
