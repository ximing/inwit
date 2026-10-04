import type { CanvasMember } from '@inwit/dto';
import { describe, expect, it } from 'vitest';
import {
  edgeAutoPan,
  linksPanelAnchor,
  mindCardTodo,
  mindMarqueeHits,
  mindRelated,
  mindSearchIds,
  mindTodoCounts,
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

describe('mindCardTodo / mindTodoCounts', () => {
  const card = (acceptance: string, dueAt: string | null, suspendedAt: string | null = null) => ({
    acceptance,
    review: dueAt ? { dueAt, suspendedAt } : null,
  });
  const now = Date.parse('2026-10-04T00:00:00Z');

  it('待确认优先于到期', () => {
    expect(mindCardTodo(card('proposed', '2026-10-01T00:00:00Z'), now)).toBe('confirm');
  });

  it('到期且未暂停是待复习，已熟悉不算', () => {
    expect(mindCardTodo(card('accepted', '2026-10-03T00:00:00Z'), now)).toBe('review');
    expect(mindCardTodo(card('accepted', '2026-10-05T00:00:00Z'), now)).toBeNull();
    expect(mindCardTodo(card('accepted', '2026-10-03T00:00:00Z', '2026-09-01T00:00:00Z'), now)).toBeNull();
    expect(mindCardTodo(card('accepted', null), now)).toBeNull();
  });

  it('待办沿父链累计到每棵子树', () => {
    const forest = [member('a'), member('b', 'a'), member('c', 'b'), member('d')];
    const todos = new Map([['c', 'review' as const], ['d', 'confirm' as const]]);
    const counts = mindTodoCounts(forest, todos);
    expect(counts.get('a')).toBe(1);
    expect(counts.get('b')).toBe(1);
    expect(counts.get('c')).toBe(1);
    expect(counts.get('d')).toBe(1);
  });
});

describe('mindMarqueeHits', () => {
  const boxes = [
    { id: 'a', x: 0, y: 0, width: 100, height: 50 },
    { id: 'b', x: 300, y: 0, width: 100, height: 50 },
    { id: 'c', x: 0, y: 200, width: 100, height: 50 },
  ];

  it('中心落在框内才算，方向任意', () => {
    expect(mindMarqueeHits(boxes, { x: -10, y: -10 }, { x: 120, y: 60 })).toEqual(['a']);
    expect(mindMarqueeHits(boxes, { x: 500, y: 300 }, { x: -10, y: -10 })).toEqual(['a', 'b', 'c']);
    expect(mindMarqueeHits(boxes, { x: 0, y: 0 }, { x: 200, y: 30 })).toEqual(['a']);
  });
});

describe('mindSearchIds', () => {
  const entries: [string, string][] = [
    ['a', '偏差与方差'],
    ['b', 'Overfitting 过拟合'],
    ['c', '正则化压方差'],
  ];

  it('大小写不敏感包含，保持顺序，空串不命中', () => {
    expect(mindSearchIds(entries, '方差')).toEqual(['a', 'c']);
    expect(mindSearchIds(entries, 'overfit')).toEqual(['b']);
    expect(mindSearchIds(entries, '  ')).toEqual([]);
  });
});

describe('edgeAutoPan', () => {
  const stage = { width: 800, height: 600 };

  it('靠边时朝对应方向加速，中间不动', () => {
    expect(edgeAutoPan({ x: 400, y: 300 }, stage)).toBeNull();
    const left = edgeAutoPan({ x: 0, y: 300 }, stage);
    expect(left?.dx).toBeGreaterThan(0);
    const right = edgeAutoPan({ x: 800, y: 300 }, stage);
    expect(right?.dx).toBeLessThan(0);
    const corner = edgeAutoPan({ x: 0, y: 0 }, stage);
    expect(corner?.dx).toBeGreaterThan(0);
    expect(corner?.dy).toBeGreaterThan(0);
  });

  it('越靠边越快', () => {
    const near = edgeAutoPan({ x: 20, y: 300 }, stage);
    const far = edgeAutoPan({ x: 2, y: 300 }, stage);
    expect(Math.abs(far?.dx ?? 0)).toBeGreaterThan(Math.abs(near?.dx ?? 0));
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
