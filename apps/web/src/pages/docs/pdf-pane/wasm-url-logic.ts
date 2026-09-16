/**
 * Blob workers (`blob:` base) cannot fetch root-relative URLs such as
 * `/node_modules/@embedpdf/pdfium/dist/pdfium.wasm` — `fetch` throws
 * `Failed to parse URL`. EmbedPDF does not surface that, so the engine
 * promise never settles. Always pass an absolute href into the worker.
 */
export function toAbsoluteUrl(url: string, origin = defaultOrigin()): string {
  if (url.length === 0) return url;
  try {
    return new URL(url).href;
  } catch {
    // relative or root-relative
  }
  if (!origin) return url;
  try {
    return new URL(url, origin).href;
  } catch {
    return url;
  }
}

function defaultOrigin(): string {
  if (typeof window === 'undefined') return '';
  try {
    return window.location.origin;
  } catch {
    return '';
  }
}
