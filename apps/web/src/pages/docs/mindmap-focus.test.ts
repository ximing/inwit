import type { CanvasMember } from '@inwit/dto';
import { describe, expect, it } from 'vitest';
import {
  linksPanelAnchor,
  mindRelated,
  minimapCenter,
  minimapFrame,
  minimapViewport,
} from './mindmap-focus';

const member = (id: string, parentId: string | null = null): CanvasMember => ({
  id,
  kind: 'card',
  parentId,
  position: 0,
});

describe('mindRelated', () => {
  // a ── b ── c
  //      └─ d ── e     f（独立树）
  const forest = [
    member('a'),
    member('b', 'a'),
    member('c', 'b'),
    member('d', 'b'),
    member('e', 'd'),
    member('f'),
  ];

  it('包含祖先、自己和整棵子树', () => {
    expect([...mindRelated(forest, 'b')].sort()).toEqual(['a', 'b', 'c', 'd', 'e']);
  });

  it('叶子节点只有祖先链', () => {
    expect([...mindRelated(forest, 'e')].sort()).toEqual(['a', 'b', 'd', 'e']);
  });

  it('环不会把遍历卡死', () => {
    const cyclic = [member('a', 'b'), member('b', 'a')];
    const related = mindRelated(cyclic, 'a');
    expect(related.has('a')).toBe(true);
    expect(related.has('b')).toBe(true);
  });
});

describe('linksPanelAnchor', () => {
  const view = { panX: 0, panY: 0, zoom: 1 };
  const stage = { width: 800, height: 600 };
  const panel = { width: 264, height: 240 };
  const box = { id: 'a', x: 100, y: 100, width: 232, height: 96 };

  it('右侧宽敞时放右边，连接线从节点右缘到面板左缘', () => {
    const anchor = linksPanelAnchor(box, view, stage, panel);
    expect(anchor.side).toBe('right');
    expect(anchor.left).toBe(100 + 232 + 14);
    expect(anchor.fromX).toBe(332);
    expect(anchor.toX).toBe(anchor.left);
  });

  it('右侧不够时翻到左边', () => {
    const nearRight = { ...box, x: 600 };
    const anchor = linksPanelAnchor(nearRight, view, stage, panel);
    expect(anchor.side).toBe('left');
    expect(anchor.left + panel.width).toBeLessThanOrEqual(600 - 14 + 1);
    expect(anchor.fromX).toBe(600);
    expect(anchor.toX).toBe(anchor.left + panel.width);
  });

  it('垂直方向夹进舞台', () => {
    const low = { ...box, y: 580 };
    const anchor = linksPanelAnchor(low, view, stage, panel);
    expect(anchor.top + panel.height).toBeLessThanOrEqual(stage.height - 8);
    const high = { ...box, y: -100 };
    expect(linksPanelAnchor(high, view, stage, panel).top).toBe(8);
  });

  it('两侧都放不下时放到节点下方，连接线从节点底缘出发', () => {
    const narrow = { width: 400, height: 600 };
    const anchor = linksPanelAnchor(box, view, narrow, panel);
    expect(anchor.side).toBe('bottom');
    expect(anchor.fromY).toBe(100 + 96);
    expect(anchor.top).toBe(anchor.fromY + 14);
    expect(anchor.fromX).toBe(216);
  });

  it('下方也不够时放到节点上方', () => {
    const narrow = { width: 400, height: 600 };
    const low = { ...box, y: 400 };
    const anchor = linksPanelAnchor(low, view, narrow, panel);
    expect(anchor.side).toBe('top');
    expect(anchor.fromY).toBe(400);
  });
});

describe('minimap', () => {
  const world = { width: 2000, height: 1000 };
  const map = { width: 168, height: 112 };
  const stage = { width: 800, height: 600 };

  it('frame 把世界等比缩进小地图并居中', () => {
    const frame = minimapFrame(world, map);
    expect(frame.scale).toBeCloseTo((168 - 16) / 2000);
    expect(world.width * frame.scale + frame.offsetX * 2).toBeCloseTo(map.width);
    expect(world.height * frame.scale).toBeLessThan(map.height);
  });

  it('视口矩形中心点映射回去得到当前平移', () => {
    const frame = minimapFrame(world, map);
    const view = { panX: -350, panY: -120, zoom: 1.2 };
    const vp = minimapViewport(view, stage, frame);
    const back = minimapCenter(vp.x + vp.width / 2, vp.y + vp.height / 2, frame, view, stage);
    expect(back.panX).toBeCloseTo(view.panX);
    expect(back.panY).toBeCloseTo(view.panY);
  });
});
