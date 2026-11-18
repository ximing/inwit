import { createHash } from "node:crypto";
import type { PdfQuad, TranslationUsage } from "@inwit/dto";

export const TRANSLATION_PROMPT_VERSION = "faithful-zh-v1";
export const UNKNOWN_USAGE: TranslationUsage = {
  usageStatus: "unknown",
  inputTokens: null,
  outputTokens: null,
  totalTokens: null,
};
export function identityHash(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}
export function normalizedTranslationText(text: string): string {
  return text.replace(/\s+/gu, " ").trim();
}
export function anchorIdentity(rects: PdfQuad[]): string {
  return identityHash(
    rects.map((quad) =>
      quad.map((p) => [
        Math.round(p.x * 100) / 100,
        Math.round(p.y * 100) / 100,
      ]),
    ),
  );
}
export function translationContentKey(input: {
  userId: string;
  documentId: string;
  fileRevision: string;
  pageIndex: number;
  sourceId: string;
  text: string;
}): string {
  return identityHash([
    input.userId,
    input.documentId,
    input.fileRevision,
    input.pageIndex,
    input.sourceId,
    identityHash(normalizedTranslationText(input.text)),
    "zh-CN",
    "faithful",
  ]);
}
export function selectionWithinPage(
  rects: PdfQuad[],
  width: number,
  height: number,
): boolean {
  return (
    rects.length > 0 &&
    rects.every((q) =>
      q.every(
        (p) =>
          Number.isFinite(p.x) &&
          Number.isFinite(p.y) &&
          p.x >= 0 &&
          p.y >= 0 &&
          p.x <= width &&
          p.y <= height,
      ),
    )
  );
}
export function isActiveTranslation(state: string): boolean {
  return ["queued", "preparing", "dispatched"].includes(state);
}
/** PDFium/PDF.js use different glyph ascent and corner ordering; compare line coverage, not raw arrays. */
export function sameSelection(rects: PdfQuad[], expected: PdfQuad[]): boolean {
  const box = (q: PdfQuad) => ({
    left: Math.min(...q.map((p) => p.x)),
    right: Math.max(...q.map((p) => p.x)),
    bottom: Math.min(...q.map((p) => p.y)),
    top: Math.max(...q.map((p) => p.y)),
  });
  const a = rects.map(box),
    b = expected.map(box);
  const overlaps = (x: ReturnType<typeof box>, y: ReturnType<typeof box>) => {
    const tolerance = Math.max(2, Math.min(5, (y.top - y.bottom) * 0.5));
    const horizontal = Math.max(
      0,
      Math.min(x.right, y.right) - Math.max(x.left, y.left),
    );
    return (
      horizontal >= Math.min(x.right - x.left, y.right - y.left) * 0.75 &&
      x.bottom <= y.top + tolerance &&
      x.top >= y.bottom - tolerance &&
      Math.abs((x.top + x.bottom - y.top - y.bottom) / 2) <=
        Math.max(x.top - x.bottom, y.top - y.bottom) * 0.75 + tolerance
    );
  };
  return (
    a.length > 0 &&
    b.length > 0 &&
    a.every((x) => b.some((y) => overlaps(x, y))) &&
    b.every((y) => a.some((x) => overlaps(x, y)))
  );
}
