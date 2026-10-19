/**
 * 概念图相机：触控板平移、捏合缩放、键盘步进、展开后按当前层重新取景。
 * 图用 SVG viewBox。zoom 为 1 时视口正好盖住整张布局。
 */

export interface GraphViewport {
  x: number;
  y: number;
  zoom: number;
}

export interface GraphStage {
  width: number;
  height: number;
}

export interface GraphWorld {
  width: number;
  height: number;
}

export interface GraphBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export const GRAPH_ZOOM_MIN = 0.35;
export const GRAPH_ZOOM_MAX = 1.75;
export const KEY_PAN_PX = 48;
export const KEY_PAN_PX_FAST = 160;
const KEY_ZOOM = 1.12;
const LINE_PX = 16;

export interface FocusFrame {
  focusId: string | null;
  /** 这一层在路径上的名字。根层是「全文」或「全部」。 */
  label: string;
  viewport: GraphViewport;
}

export function clampZoom(zoom: number): number {
  if (!Number.isFinite(zoom)) return 1;
  return Math.min(GRAPH_ZOOM_MAX, Math.max(GRAPH_ZOOM_MIN, zoom));
}

export function viewBoxSize(world: GraphWorld, zoom: number): { width: number; height: number } {
  const z = zoom > 0 && Number.isFinite(zoom) ? zoom : 1;
  return {
    width: Math.max(world.width, 1) / z,
    height: Math.max(world.height, 1) / z,
  };
}

/** viewBox 在舞台上 xMidYMid meet 之后的像素比例和留白。 */
export function viewMeet(
  stage: GraphStage,
  box: { width: number; height: number },
): { scale: number; offsetX: number; offsetY: number } {
  const sw = Math.max(stage.width, 1);
  const sh = Math.max(stage.height, 1);
  const scale = Math.min(sw / Math.max(box.width, 1), sh / Math.max(box.height, 1));
  return {
    scale: scale > 0 ? scale : 1,
    offsetX: (sw - box.width * scale) / 2,
    offsetY: (sh - box.height * scale) / 2,
  };
}

function meetOf(viewport: GraphViewport, world: GraphWorld, stage: GraphStage) {
  return viewMeet(stage, viewBoxSize(world, viewport.zoom));
}

/** 屏幕像素平移。手指往右拖时内容跟着走，视口原点减小。 */
export function panByPixels(
  viewport: GraphViewport,
  world: GraphWorld,
  stage: GraphStage,
  deltaX: number,
  deltaY: number,
): GraphViewport {
  const { scale } = meetOf(viewport, world, stage);
  return {
    ...viewport,
    x: viewport.x + deltaX / scale,
    y: viewport.y + deltaY / scale,
  };
}

export function wheelPixels(delta: number, deltaMode: number, page: number): number {
  if (!Number.isFinite(delta)) return 0;
  if (deltaMode === 1) return delta * LINE_PX;
  if (deltaMode === 2) return delta * Math.max(page, 1);
  return delta;
}

/** 滚轮 / 触控板双指：delta 为正时视口往内容下方、右方移动。 */
export function panByWheel(
  viewport: GraphViewport,
  world: GraphWorld,
  stage: GraphStage,
  deltaX: number,
  deltaY: number,
  deltaMode = 0,
): GraphViewport {
  return panByPixels(
    viewport,
    world,
    stage,
    wheelPixels(deltaX, deltaMode, stage.width),
    wheelPixels(deltaY, deltaMode, stage.height),
  );
}

/** 以舞台上某一点为锚缩放，锚下的世界坐标保持不动。 */
export function zoomAt(
  viewport: GraphViewport,
  world: GraphWorld,
  stage: GraphStage,
  clientX: number,
  clientY: number,
  factor: number,
): GraphViewport {
  if (!Number.isFinite(factor) || factor === 1) return viewport;
  const before = meetOf(viewport, world, stage);
  const worldX = viewport.x + (clientX - before.offsetX) / before.scale;
  const worldY = viewport.y + (clientY - before.offsetY) / before.scale;
  const zoom = clampZoom(viewport.zoom * factor);
  const after = viewMeet(stage, viewBoxSize(world, zoom));
  return {
    zoom,
    x: worldX - (clientX - after.offsetX) / after.scale,
    y: worldY - (clientY - after.offsetY) / after.scale,
  };
}

export function zoomAtCenter(
  viewport: GraphViewport,
  world: GraphWorld,
  stage: GraphStage,
  factor: number,
): GraphViewport {
  return zoomAt(viewport, world, stage, stage.width / 2, stage.height / 2, factor);
}

const FRAME_PAD = 28;

/**
 * 进入下一层：当前概念放在视口中央，并尽量把这一层的节点都收进画面。
 * 视口宽高比跟布局走，装不下时停在最小缩放。
 */
export function frameNeighborhood(
  world: GraphWorld,
  stage: GraphStage,
  focus: GraphBox,
  boxes: readonly GraphBox[],
): GraphViewport {
  const cx = focus.x + focus.width / 2;
  const cy = focus.y + focus.height / 2;
  let halfW = focus.width / 2;
  let halfH = focus.height / 2;
  for (const box of boxes) {
    halfW = Math.max(halfW, cx - box.x, box.x + box.width - cx);
    halfH = Math.max(halfH, cy - box.y, box.y + box.height - cy);
  }
  halfW += FRAME_PAD;
  halfH += FRAME_PAD;
  const zoom = clampZoom(
    Math.min(Math.max(world.width, 1) / (2 * halfW), Math.max(world.height, 1) / (2 * halfH)),
  );
  return centerViewportOn({ x: 0, y: 0, zoom }, world, stage, focus);
}

/** 这些节点盒是否都落在当前 viewBox 里。整图可见时可以收起小地图。 */
export function viewportCoversBoxes(
  viewport: GraphViewport,
  world: GraphWorld,
  boxes: readonly GraphBox[],
  slack = 1,
): boolean {
  if (boxes.length === 0) return true;
  const size = viewBoxSize(world, viewport.zoom);
  const left = viewport.x - slack;
  const top = viewport.y - slack;
  const right = viewport.x + size.width + slack;
  const bottom = viewport.y + size.height + slack;
  return boxes.every(
    (box) => box.x >= left && box.y >= top && box.x + box.width <= right && box.y + box.height <= bottom,
  );
}

/** 把节点盒的中心放到舞台中央，缩放保持不变。 */
export function centerViewportOn(
  viewport: GraphViewport,
  world: GraphWorld,
  stage: GraphStage,
  box: GraphBox,
): GraphViewport {
  const meet = meetOf(viewport, world, stage);
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  return {
    ...viewport,
    x: cx - (stage.width / 2 - meet.offsetX) / meet.scale,
    y: cy - (stage.height / 2 - meet.offsetY) / meet.scale,
  };
}

export function fitViewport(): GraphViewport {
  return { x: 0, y: 0, zoom: 1 };
}

export interface MinimapFrame {
  scale: number;
  offsetX: number;
  offsetY: number;
}

export function conceptMinimapFrame(world: GraphWorld, map: GraphStage, pad = 8): MinimapFrame {
  const w = Math.max(world.width, 1);
  const h = Math.max(world.height, 1);
  const scale = Math.min((map.width - pad * 2) / w, (map.height - pad * 2) / h);
  const safe = scale > 0 ? scale : 1;
  return {
    scale: safe,
    offsetX: (map.width - w * safe) / 2,
    offsetY: (map.height - h * safe) / 2,
  };
}

export function conceptMinimapViewport(
  viewport: GraphViewport,
  world: GraphWorld,
  frame: MinimapFrame,
): GraphBox {
  const box = viewBoxSize(world, viewport.zoom);
  return {
    x: viewport.x * frame.scale + frame.offsetX,
    y: viewport.y * frame.scale + frame.offsetY,
    width: box.width * frame.scale,
    height: box.height * frame.scale,
  };
}

/** 点在小地图上的位置，返回把对应世界点移到舞台中央的视口。 */
export function conceptMinimapCenter(
  mapX: number,
  mapY: number,
  frame: MinimapFrame,
  viewport: GraphViewport,
  world: GraphWorld,
  stage: GraphStage,
): GraphViewport {
  const worldX = (mapX - frame.offsetX) / frame.scale;
  const worldY = (mapY - frame.offsetY) / frame.scale;
  return centerViewportOn(viewport, world, stage, { x: worldX, y: worldY, width: 0, height: 0 });
}

/** 进入下一层前压入当前层。已经在这一层上则不重复压栈。 */
export function pushFocus(stack: readonly FocusFrame[], current: FocusFrame, nextId: string): FocusFrame[] {
  if (current.focusId === nextId) return [...stack];
  return [...stack, { focusId: current.focusId, label: current.label, viewport: { ...current.viewport } }];
}

export function popFocus(stack: readonly FocusFrame[]): { stack: FocusFrame[]; frame: FocusFrame | null } {
  if (stack.length === 0) return { stack: [], frame: null };
  const frame = stack[stack.length - 1]!;
  return { stack: stack.slice(0, -1), frame };
}

export function keyboardPan(key: string, fast: boolean): { x: number; y: number } | null {
  const step = fast ? KEY_PAN_PX_FAST : KEY_PAN_PX;
  if (key === 'ArrowLeft') return { x: -step, y: 0 };
  if (key === 'ArrowRight') return { x: step, y: 0 };
  if (key === 'ArrowUp') return { x: 0, y: -step };
  if (key === 'ArrowDown') return { x: 0, y: step };
  return null;
}

export function keyboardZoomFactor(key: string): number | null {
  if (key === '+' || key === '=' || key === 'Add') return KEY_ZOOM;
  if (key === '-' || key === '_' || key === 'Subtract') return 1 / KEY_ZOOM;
  return null;
}
