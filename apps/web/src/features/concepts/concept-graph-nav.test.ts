import { describe, expect, it } from 'vitest';
import {
  centerViewportOn,
  conceptMinimapCenter,
  conceptMinimapFrame,
  fitViewport,
  frameNeighborhood,
  GRAPH_ZOOM_MAX,
  keyboardPan,
  keyboardZoomFactor,
  panByWheel,
  popFocus,
  pushFocus,
  viewBoxSize,
  boxIntersectsView,
  viewportCoversBoxes,
  zoomAt,
} from './concept-graph-nav.js';

const world = { width: 800, height: 600 };
const stage = { width: 400, height: 300 };

describe('concept graph navigation', () => {
  it('视口外的节点不绘制，贴边的留在画布里', () => {
    const view = { x: 100, y: 80, width: 200, height: 120 };
    expect(boxIntersectsView({ x: 90, y: 90, width: 40, height: 28 }, view)).toBe(true);
    expect(boxIntersectsView({ x: 400, y: 90, width: 40, height: 28 }, view)).toBe(false);
    expect(boxIntersectsView({ x: 340, y: 90, width: 40, height: 28 }, view, 80)).toBe(true);
  });

  it('触控板滑动按像素平移，不再要求按住修饰键', () => {
    const next = panByWheel({ x: 0, y: 0, zoom: 1 }, world, stage, 40, -20);
    expect(next.zoom).toBe(1);
    expect(next.x).toBeGreaterThan(0);
    expect(next.y).toBeLessThan(0);
  });

  it('捏合以指针下的点为锚，放大后该点仍在指针下', () => {
    const start = { x: 10, y: 20, zoom: 1 };
    const next = zoomAt(start, world, stage, 100, 80, 1.5);
    expect(next.zoom).toBeCloseTo(1.5);
    const beforeScale = Math.min(stage.width / world.width, stage.height / world.height);
    const worldX = start.x + (100 - (stage.width - world.width * beforeScale) / 2) / beforeScale;
    const afterBoxW = world.width / next.zoom;
    const afterBoxH = world.height / next.zoom;
    const afterScale = Math.min(stage.width / afterBoxW, stage.height / afterBoxH);
    const afterOffsetX = (stage.width - afterBoxW * afterScale) / 2;
    expect(next.x + (100 - afterOffsetX) / afterScale).toBeCloseTo(worldX);
  });

  it('进入下一层后把节点中心放到舞台中央', () => {
    const next = centerViewportOn(
      { x: 0, y: 0, zoom: 1 },
      world,
      stage,
      { x: 400, y: 200, width: 148, height: 56 },
    );
    const scale = Math.min(stage.width / world.width, stage.height / world.height);
    const offsetX = (stage.width - world.width * scale) / 2;
    const offsetY = (stage.height - world.height * scale) / 2;
    const cx = 400 + 74;
    const cy = 200 + 28;
    expect(next.x + (stage.width / 2 - offsetX) / scale).toBeCloseTo(cx);
    expect(next.y + (stage.height / 2 - offsetY) / scale).toBeCloseTo(cy);
    expect(next.zoom).toBe(1);
  });

  it('小地图把点中的世界位置移到中央', () => {
    const frame = conceptMinimapFrame(world, { width: 168, height: 112 });
    const mapX = frame.offsetX + 200 * frame.scale;
    const mapY = frame.offsetY + 100 * frame.scale;
    const next = conceptMinimapCenter(mapX, mapY, frame, { x: 0, y: 0, zoom: 1 }, world, stage);
    const centered = centerViewportOn({ x: 0, y: 0, zoom: 1 }, world, stage, {
      x: 200,
      y: 100,
      width: 0,
      height: 0,
    });
    expect(next.x).toBeCloseTo(centered.x);
    expect(next.y).toBeCloseTo(centered.y);
  });

  it('进入下一层时把当前概念放在中央，并尽量装下周围节点', () => {
    const focus = { x: 100, y: 80, width: 148, height: 56 };
    const neighbor = { x: 400, y: 300, width: 148, height: 56 };
    const next = frameNeighborhood(world, stage, focus, [focus, neighbor]);
    const box = viewBoxSize(world, next.zoom);
    const cx = focus.x + focus.width / 2;
    const cy = focus.y + focus.height / 2;
    expect(next.x + box.width / 2).toBeCloseTo(cx);
    expect(next.y + box.height / 2).toBeCloseTo(cy);
    expect(neighbor.x).toBeGreaterThanOrEqual(next.x - 1);
    expect(neighbor.x + neighbor.width).toBeLessThanOrEqual(next.x + box.width + 1);
    expect(neighbor.y).toBeGreaterThanOrEqual(next.y - 1);
    expect(neighbor.y + neighbor.height).toBeLessThanOrEqual(next.y + box.height + 1);
    expect(next.zoom).toBeGreaterThanOrEqual(0.35);
    expect(next.zoom).toBeLessThanOrEqual(GRAPH_ZOOM_MAX);
  });

  it('放大可以超过 1.75，再往上停在上限', () => {
    const next = zoomAt({ x: 0, y: 0, zoom: 1.75 }, world, stage, 200, 150, 2);
    expect(next.zoom).toBeGreaterThan(1.75);
    expect(next.zoom).toBeLessThanOrEqual(GRAPH_ZOOM_MAX);
    const capped = zoomAt({ x: 0, y: 0, zoom: GRAPH_ZOOM_MAX }, world, stage, 200, 150, 2);
    expect(capped.zoom).toBe(GRAPH_ZOOM_MAX);
    expect(capped.x).toBe(0);
    expect(capped.y).toBe(0);
  });

  it('整图都在视口内时可以收起小地图', () => {
    const boxes = [{ x: 40, y: 40, width: 148, height: 56 }];
    expect(viewportCoversBoxes({ x: 0, y: 0, zoom: 1 }, world, boxes)).toBe(true);
    expect(viewportCoversBoxes({ x: 500, y: 0, zoom: 1.5 }, world, boxes)).toBe(false);
  });

  it('展开压栈，返回弹出上一层视口；同一层不重复压', () => {
    const root = { focusId: null, label: '全文', viewport: { x: 1, y: 2, zoom: 1 } };
    const once = pushFocus([], root, 'a');
    expect(once).toEqual([root]);
    expect(pushFocus(once, { focusId: 'a', label: '甲', viewport: fitViewport() }, 'a')).toEqual(once);
    const back = popFocus(once);
    expect(back.frame).toEqual(root);
    expect(back.stack).toEqual([]);
    expect(popFocus([]).frame).toBeNull();
  });

  it('方向键平移，加减号缩放，0 是适应', () => {
    expect(keyboardPan('ArrowLeft', false)).toEqual({ x: -48, y: 0 });
    expect(keyboardPan('ArrowDown', true)?.y).toBe(160);
    expect(keyboardPan('a', false)).toBeNull();
    expect(keyboardZoomFactor('+')).toBeGreaterThan(1);
    expect(keyboardZoomFactor('-')).toBeLessThan(1);
    expect(keyboardZoomFactor('0')).toBeNull();
    expect(fitViewport()).toEqual({ x: 0, y: 0, zoom: 1 });
  });
});
