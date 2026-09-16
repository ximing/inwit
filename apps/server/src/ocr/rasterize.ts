import { createRequire } from 'node:module';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  getDocument,
  GlobalWorkerOptions,
  type PDFDocumentProxy,
} from 'pdfjs-dist/legacy/build/pdf.mjs';
import { config } from '../config.js';

const require = createRequire(import.meta.url);
const pdfjsRoot = path.dirname(require.resolve('pdfjs-dist/package.json'));
const workerSrc = pathToFileURL(path.join(pdfjsRoot, 'legacy/build/pdf.worker.mjs')).href;

function assetUrl(subdir: string): string {
  return `${pathToFileURL(path.join(pdfjsRoot, subdir)).href}/`;
}

const CMAP_URL = assetUrl('cmaps');
const STANDARD_FONT_DATA_URL = assetUrl('standard_fonts');
const WASM_URL = assetUrl('wasm');
const ICC_URL = assetUrl('iccs');

type PdfjsWorkerModule = { WorkerMessageHandler: unknown };

let workerModule: PdfjsWorkerModule | undefined;

/**
 * Node pdfjs disables Worker threads and runs a main-thread fake worker.
 * Fake-worker setup prefers `globalThis.pdfjsWorker` over `workerSrc`.
 * unpdf ships a bundled pdfjs 6.1.200 that assigns that global; pin both
 * the global and workerSrc to this pdfjs-dist copy before every getDocument.
 */
async function pinPdfjsWorker(): Promise<void> {
  GlobalWorkerOptions.workerSrc = workerSrc;
  workerModule ??= (await import(workerSrc)) as PdfjsWorkerModule;
  (globalThis as { pdfjsWorker?: PdfjsWorkerModule }).pdfjsWorker = workerModule;
}

/** Cap the long edge so a huge page does not allocate a multi-GB canvas. */
const MAX_EDGE_PX = 4096;

type CanvasAndContext = {
  canvas: { width: number; height: number; toBuffer: (mime: 'image/png') => Buffer };
  context: unknown;
};

type CanvasFactory = {
  create: (width: number, height: number) => CanvasAndContext;
  destroy: (canvasAndContext: CanvasAndContext) => void;
};

export interface OpenPdf {
  pageCount: number;
  renderPng: (pageIndex: number, dpi?: number) => Promise<Buffer>;
  destroy: () => Promise<void>;
}

export async function openPdf(filePath: string): Promise<OpenPdf> {
  await pinPdfjsWorker();
  const loadingTask = getDocument({
    url: pathToFileURL(filePath).href,
    cMapUrl: CMAP_URL,
    cMapPacked: true,
    standardFontDataUrl: STANDARD_FONT_DATA_URL,
    wasmUrl: WASM_URL,
    iccUrl: ICC_URL,
    useSystemFonts: true,
  });
  const pdf: PDFDocumentProxy = await loadingTask.promise;
  const canvasFactory = pdf.canvasFactory as CanvasFactory;

  return {
    pageCount: pdf.numPages,
    async renderPng(pageIndex: number, dpi = config.OCR_RASTER_DPI) {
      if (pageIndex < 0 || pageIndex >= pdf.numPages) {
        throw new Error(`ocr rasterize: page ${pageIndex} out of range`);
      }
      const page = await pdf.getPage(pageIndex + 1);
      try {
        const base = page.getViewport({ scale: 1 });
        let scale = dpi / 72;
        const maxEdge = Math.max(base.width, base.height) * scale;
        if (maxEdge > MAX_EDGE_PX) scale *= MAX_EDGE_PX / maxEdge;
        const viewport = page.getViewport({ scale });
        const canvasAndContext = canvasFactory.create(
          Math.ceil(viewport.width),
          Math.ceil(viewport.height),
        );
        try {
          await page.render({
            canvas: canvasAndContext.canvas as never,
            canvasContext: canvasAndContext.context as never,
            viewport,
          }).promise;
          return canvasAndContext.canvas.toBuffer('image/png');
        } finally {
          canvasFactory.destroy(canvasAndContext);
        }
      } finally {
        page.cleanup();
      }
    },
    async destroy() {
      await pdf.cleanup();
      await loadingTask.destroy();
    },
  };
}
