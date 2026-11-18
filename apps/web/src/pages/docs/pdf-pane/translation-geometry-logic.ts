import type { PdfPageGeometry, PdfPoint, PdfQuad } from '@inwit/dto';
export type PageSize = { width: number; height: number };
/** EmbedPDF normalizes intrinsic rotation: coordinates stay unrotated top-left. Rotate handles display rotation. */
export function toEnginePoint(p: PdfPoint, g: PdfPageGeometry, size: PageSize): PdfPoint {
  return { x: (p.x * size.width) / g.width, y: ((g.height - p.y) * size.height) / g.height };
}
export function fromEnginePoint(p: PdfPoint, g: PdfPageGeometry, size: PageSize): PdfPoint {
  return { x: (p.x * g.width) / size.width, y: g.height - (p.y * g.height) / size.height };
}
export function quadBounds(quad: PdfQuad, g: PdfPageGeometry, size: PageSize, scale = 1) {
  const pts = quad.map((p) => toEnginePoint(p, g, size));
  const left = Math.min(...pts.map((p) => p.x)) * scale,
    top = Math.min(...pts.map((p) => p.y)) * scale;
  return {
    left,
    top,
    width: Math.max(...pts.map((p) => p.x)) * scale - left,
    height: Math.max(...pts.map((p) => p.y)) * scale - top,
  };
}
type Box = { left: number; right: number; top: number; bottom: number };
export function floatingPosition(
  anchor: Box,
  reader: Box,
  options: { page?: Box; height?: number } = {},
) {
  const gap = 12;
  const width = Math.min(360, Math.max(0, reader.right - reader.left - gap * 2));
  const height = Math.min(options.height ?? 420, Math.max(0, reader.bottom - reader.top - gap * 2));
  const clamp = (n: number, min: number, max: number) => Math.max(min, Math.min(n, max));
  const left = clamp(anchor.left, reader.left + gap, reader.right - width - gap);
  const top = clamp(anchor.top, reader.top + gap, reader.bottom - height - gap);
  const page = options.page ?? anchor;
  // Page margins first; only then consider space around the complete paragraph.
  const candidates = [
    { left: page.right + gap, top },
    { left: page.left - width - gap, top },
    { left, top: anchor.bottom + gap },
    { left, top: anchor.top - height - gap },
    { left: anchor.right + gap, top },
    { left: anchor.left - width - gap, top },
  ];
  const fits = (p: { left: number; top: number }) =>
    p.left >= reader.left + gap &&
    p.left + width <= reader.right - gap &&
    p.top >= reader.top + gap &&
    p.top + height <= reader.bottom - gap;
  const clear = (p: { left: number; top: number }) =>
    p.left + width <= anchor.left - gap ||
    p.left >= anchor.right + gap ||
    p.top + height <= anchor.top - gap ||
    p.top >= anchor.bottom + gap;
  const safe = candidates.find((p) => fits(p) && clear(p));
  if (safe) return { ...safe, width, maxHeight: height, docked: false };
  // A shorter scrolling panel can still leave the whole original paragraph clear.
  const above = anchor.top - gap - (reader.top + gap);
  const below = reader.bottom - gap - (anchor.bottom + gap);
  if (Math.max(above, below) >= 180) {
    const maxHeight = Math.min(height, Math.max(above, below));
    return {
      left,
      top: below >= above ? anchor.bottom + gap : anchor.top - gap - maxHeight,
      width,
      maxHeight,
      docked: false,
    };
  }
  return { left: reader.right - width - gap, top, width, maxHeight: height, docked: true };
}
