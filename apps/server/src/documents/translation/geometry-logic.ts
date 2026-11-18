/** Unrotated CropBox-local points: origin bottom-left, UserUnit applied once. */
export type Point = { x: number; y: number };
export type Quad = [Point, Point, Point, Point];
export type PageGeometry = {
  coordinateVersion: "crop-local-points-v1";
  /** Compatibility alias for the effective visible box, not the raw PDF dictionary. */
  cropBox: [number, number, number, number];
  effectiveCropBox?: [number, number, number, number];
  /** pdfjs public metadata does not expose the un-intersected inherited CropBox. */
  rawCropBox?: null;
  userUnit: number;
  intrinsicRotation: 0 | 90 | 180 | 270;
  width: number;
  height: number;
};
export function pdfToLocal(point: Point, geometry: PageGeometry): Point {
  return {
    x: (point.x - geometry.cropBox[0]) * geometry.userUnit,
    y: (point.y - geometry.cropBox[1]) * geometry.userUnit,
  };
}
export function localToViewport(
  point: Point,
  geometry: PageGeometry,
  scale = 1,
  viewerRotation = 0,
): Point {
  const rotation =
    (((geometry.intrinsicRotation + viewerRotation) % 360) + 360) % 360;
  const { x, y } = point;
  const { width: w, height: h } = geometry;
  const p =
    rotation === 90
      ? { x: y, y: x }
      : rotation === 180
        ? { x: w - x, y }
        : rotation === 270
          ? { x: h - y, y: w - x }
          : { x, y: h - y };
  return { x: p.x * scale, y: p.y * scale };
}
export function viewportToLocal(
  point: Point,
  geometry: PageGeometry,
  scale = 1,
  viewerRotation = 0,
): Point {
  const rotation =
    (((geometry.intrinsicRotation + viewerRotation) % 360) + 360) % 360;
  const x = point.x / scale,
    y = point.y / scale;
  const { width: w, height: h } = geometry;
  return rotation === 90
    ? { x: y, y: x }
    : rotation === 180
      ? { x: w - x, y }
      : rotation === 270
        ? { x: w - y, y: h - x }
        : { x, y: h - y };
}
export function pointInQuad(point: Point, quad: Quad): boolean {
  const crosses = quad.map((a, i) => {
    const b = quad[(i + 1) % 4]!;
    return (b.x - a.x) * (point.y - a.y) - (b.y - a.y) * (point.x - a.x);
  });
  return crosses.every((v) => v >= -0.01) || crosses.every((v) => v <= 0.01);
}
