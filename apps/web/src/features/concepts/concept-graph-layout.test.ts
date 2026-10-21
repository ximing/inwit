import { describe, expect, it } from 'vitest';
import {
  conceptGraphIsDense,
  conceptNodeMetrics,
  conceptReadingFocus,
  layoutConceptGraph,
  layoutHasOverlap,
  showConceptEdgeLabel,
  type ConceptGraphLayout,
} from './concept-graph-layout.js';
import {
  clampDockRatio,
  clampMainRatio,
  dockRatioFromDrag,
  effectiveLayout,
  modeForConceptGeneration,
} from '../study-workspace/study-layout.js';

function concepts(...ids: string[]) {
  return ids.map((id) => ({ id }));
}

function centerGap(layout: ConceptGraphLayout, fromId: string, toId: string): number {
  const a = layout.nodes.find((node) => node.id === fromId)!;
  const b = layout.nodes.find((node) => node.id === toId)!;
  const dist = Math.hypot(
    a.x + a.width / 2 - (b.x + b.width / 2),
    a.y + a.height / 2 - (b.y + b.height / 2),
  );
  return dist - a.width / 2 - b.width / 2;
}

describe('concept-graph-layout', () => {
  it('节点不重叠；合法环可布局', () => {
    const layout = layoutConceptGraph(
      concepts('a', 'b', 'c'),
      [
        { fromConceptId: 'a', toConceptId: 'b' },
        { fromConceptId: 'b', toConceptId: 'c' },
        { fromConceptId: 'c', toConceptId: 'a' },
      ],
    );
    expect(layout.nodes).toHaveLength(3);
    expect(layoutHasOverlap(layout)).toBe(false);
  });

  it('增量更新保留已有节点位置；新节点不与旧节点重叠', () => {
    const previous = new Map([
      ['a', { x: 100, y: 100 }],
      ['b', { x: 400, y: 120 }],
    ]);
    const layout = layoutConceptGraph(
      concepts('a', 'b', 'c', 'd'),
      [
        { fromConceptId: 'a', toConceptId: 'c' },
        { fromConceptId: 'b', toConceptId: 'd' },
      ],
      previous,
    );
    const a = layout.nodes.find((node) => node.id === 'a')!;
    expect(a.x).toBe(100);
    expect(a.y).toBe(100);
    expect(layoutHasOverlap(layout)).toBe(false);
  });

  it('空图安全', () => {
    const layout = layoutConceptGraph([], []);
    expect(layout.nodes).toHaveLength(0);
  });

  it('短名称更窄，稍长的名称完整显示', () => {
    const short = conceptNodeMetrics('力');
    const medium = conceptNodeMetrics('间隔重复算法');
    const longer = conceptNodeMetrics('稍微长一点的概念名称');
    expect(medium.label).toBe('间隔重复算法');
    expect(longer.label).toBe('稍微长一点的概念名称');
    expect(longer.width).toBeGreaterThan(medium.width);
    expect(medium.width).toBeGreaterThan(short.width);
    expect(short.height).toBe(28);
  });

  it('特别长的名称省略，宽度有上限', () => {
    const long = conceptNodeMetrics('这是一个长到不该占满整行的概念名称用来验证省略');
    expect(long.label.endsWith('…')).toBe(true);
    expect(long.label.length).toBeLessThan(30);
    expect(long.width).toBeLessThan(320);
    expect(long.width).toBeGreaterThan(conceptNodeMetrics('短').width);
  });

  it('较多节点仍不重叠，已有位置不被松弛挪走', () => {
    const ids = Array.from({ length: 24 }, (_, index) => `n${index}`);
    const relations = ids.slice(0, -1).map((id, index) => ({
      fromConceptId: id,
      toConceptId: ids[index + 1]!,
    }));
    const layout = layoutConceptGraph(
      ids.map((id, index) => ({ id, name: index % 3 === 0 ? `概念${index}的稍长名称` : `概念${index}` })),
      relations,
    );
    expect(layoutHasOverlap(layout)).toBe(false);
    const previous = new Map(layout.nodes.map((node) => [node.id, { x: node.x, y: node.y }]));
    const again = layoutConceptGraph(
      ids.map((id) => ({ id, name: '概念' })),
      relations,
      previous,
    );
    for (const node of again.nodes) {
      const before = previous.get(node.id)!;
      expect(node.x).toBe(before.x);
      expect(node.y).toBe(before.y);
    }
  });

  it('相连节点按谓词留出空隙，长谓词比短谓词更开', () => {
    const pair = [
      { id: 'a', name: '四个核心闭环' },
      { id: 'b', name: '三层决策拆分' },
    ];
    const short = layoutConceptGraph(pair, [
      { fromConceptId: 'a', toConceptId: 'b', predicate: '包含' },
    ]);
    const long = layoutConceptGraph(pair, [
      { fromConceptId: 'a', toConceptId: 'b', predicate: '以只负责协调的智能体为中心组织起来' },
    ]);
    expect(layoutHasOverlap(short)).toBe(false);
    expect(layoutHasOverlap(long)).toBe(false);
    expect(centerGap(short, 'a', 'b')).toBeGreaterThan(90);
    expect(centerGap(long, 'a', 'b')).toBeGreaterThan(centerGap(short, 'a', 'b') + 80);
    expect(centerGap(long, 'a', 'b')).toBeGreaterThan(180);
  });

  it('同一节点的多条长关系会把邻居撑开', () => {
    const ids = ['hub', 'n0', 'n1', 'n2', 'n3', 'n4', 'n5'];
    const layout = layoutConceptGraph(
      ids.map((id) => ({ id, name: id === 'hub' ? '四个核心闭环' : `邻居概念${id}` })),
      ids.slice(1).map((id) => ({
        fromConceptId: 'hub',
        toConceptId: id,
        predicate: '验证闭环以外部证据判定完成',
      })),
    );
    expect(layoutHasOverlap(layout)).toBe(false);
    for (const id of ids.slice(1)) {
      expect(centerGap(layout, 'hub', id)).toBeGreaterThan(140);
    }
    const neighbors = layout.nodes.filter((node) => node.id !== 'hub');
    let closest = Number.POSITIVE_INFINITY;
    for (let i = 0; i < neighbors.length; i += 1) {
      for (let j = i + 1; j < neighbors.length; j += 1) {
        closest = Math.min(closest, centerGap(layout, neighbors[i]!.id, neighbors[j]!.id));
      }
    }
    expect(closest).toBeGreaterThan(48);
  });

  it('十几个节点、长谓词的图也不叠在一起', () => {
    const ids = Array.from({ length: 18 }, (_, index) => `n${index}`);
    const predicates = [
      '以只负责协调的智能体为中心组织',
      '验证闭环以外部证据判定完成',
      '副作用区别于具体执行',
    ];
    const relations = ids.slice(0, -1).map((id, index) => ({
      fromConceptId: id,
      toConceptId: ids[(index + 1) % ids.length]!,
      predicate: predicates[index % predicates.length]!,
    }));
    for (let index = 0; index < ids.length; index += 3) {
      relations.push({
        fromConceptId: ids[index]!,
        toConceptId: ids[(index + 5) % ids.length]!,
        predicate: predicates[index % predicates.length]!,
      });
    }
    const layout = layoutConceptGraph(
      ids.map((id, index) => ({ id, name: index % 2 === 0 ? `概念名称${index}` : `稍长的概念${index}` })),
      relations,
    );
    expect(layoutHasOverlap(layout)).toBe(false);
    for (const relation of relations) {
      expect(centerGap(layout, relation.fromConceptId, relation.toConceptId)).toBeGreaterThan(90);
    }
  });

  it('用户拖过的位置不会因为加宽间距被挪走', () => {
    const previous = new Map([
      ['a', { x: 10, y: 10 }],
      ['b', { x: 40, y: 12 }],
    ]);
    const layout = layoutConceptGraph(
      [
        { id: 'a', name: '甲' },
        { id: 'b', name: '乙' },
      ],
      [{ fromConceptId: 'a', toConceptId: 'b', predicate: '以只负责协调的智能体为中心组织起来' }],
      previous,
    );
    expect(layout.nodes.find((node) => node.id === 'a')).toMatchObject({ x: 10, y: 10 });
    expect(layout.nodes.find((node) => node.id === 'b')).toMatchObject({ x: 40, y: 12 });
  });
});

describe('concept reading focus', () => {
  const relations = [
    { id: 'ab', fromConceptId: 'a', toConceptId: 'b' },
    { id: 'bc', fromConceptId: 'b', toConceptId: 'c' },
    { id: 'ac', fromConceptId: 'a', toConceptId: 'c' },
    { id: 'cd', fromConceptId: 'c', toConceptId: 'd' },
  ];

  it('选中节点时只留它、一级邻居，以及连到它的边', () => {
    const focus = conceptReadingFocus({
      selectedConceptId: 'b',
      selectedRelation: null,
      relations,
    });
    expect([...(focus?.nodeIds ?? [])].sort()).toEqual(['a', 'b', 'c']);
    expect([...(focus?.edgeIds ?? [])].sort()).toEqual(['ab', 'bc']);
  });

  it('没选中时不聚焦', () => {
    expect(conceptReadingFocus({
      selectedConceptId: null,
      selectedRelation: null,
      relations,
    })).toBeNull();
  });

  it('选中关系时只留这条边的两端', () => {
    const focus = conceptReadingFocus({
      selectedConceptId: null,
      selectedRelation: relations[2]!,
      relations,
    });
    expect([...(focus?.nodeIds ?? [])].sort()).toEqual(['a', 'c']);
    expect([...(focus?.edgeIds ?? [])]).toEqual(['ac']);
  });
});

describe('concept edge labels', () => {
  it('节点一多就先藏起谓词，选中或放大后再显示', () => {
    expect(conceptGraphIsDense(15, 0)).toBe(true);
    expect(conceptGraphIsDense(4, 4)).toBe(false);
    expect(showConceptEdgeLabel({ dense: true, zoom: 1, selected: false, highlighted: false })).toBe(false);
    expect(showConceptEdgeLabel({ dense: true, zoom: 1, selected: true, highlighted: false })).toBe(true);
    expect(showConceptEdgeLabel({ dense: true, zoom: 1.2, selected: false, highlighted: false })).toBe(true);
    expect(showConceptEdgeLabel({ dense: false, zoom: 0.4, selected: false, highlighted: false })).toBe(true);
  });
});

describe('study-layout', () => {
  const compare = { preferredMode: 'compare', arrangement: 'stacked', mainRatio: 0.6, dockRatio: 0.5, zoomedPane: null } as const;

  it('三栏/上下/聚焦/窄屏降级与恢复', () => {
    // 宽屏尊重用户排列偏好（stacked 保持上下；选 columns 才横向）
    expect(effectiveLayout(compare, { width: 1920, height: 1080 }).arrangement).toBe('stacked');
    expect(
      effectiveLayout({ ...compare, arrangement: 'columns' }, { width: 1920, height: 1080 }).arrangement,
    ).toBe('columns');
    expect(effectiveLayout(compare, { width: 1440, height: 900 })).toMatchObject({
      mode: 'compare', arrangement: 'stacked', degraded: false,
    });
    expect(effectiveLayout(compare, { width: 1100, height: 800 })).toMatchObject({
      mode: 'compare', arrangement: 'stacked', degraded: false,
    });
    expect(effectiveLayout(compare, { width: 900, height: 700 }, 'concepts')).toMatchObject({
      mode: 'concepts', degraded: true, focusedPane: 'concepts',
    });
    expect(effectiveLayout(compare, { width: 390, height: 844 }, 'outline')).toMatchObject({
      mode: 'outline', degraded: true,
    });
  });

  it('零尺寸不降级不清状态', () => {
    expect(effectiveLayout(compare, { width: 0, height: 0 }).degraded).toBe(false);
  });

  it('生成概念与关系只从结构切到概念，对照和概念保持不动', () => {
    expect(modeForConceptGeneration('outline')).toBe('concepts');
    expect(modeForConceptGeneration('compare')).toBeNull();
    expect(modeForConceptGeneration('concepts')).toBeNull();
  });

  it('非对照模式不受容器影响；比例限幅', () => {
    expect(
      effectiveLayout({ ...compare, preferredMode: 'concepts' }, { width: 390, height: 844 }).mode,
    ).toBe('concepts');
    expect(clampMainRatio(0.1)).toBe(0.3);
    expect(clampMainRatio(0.9)).toBe(0.75);
    expect(clampDockRatio(0.95)).toBe(0.8);
    expect(dockRatioFromDrag(0.5, 100, 200, 400)).toBeCloseTo(0.75);
    expect(dockRatioFromDrag(0.5, 100, 0, 200)).toBe(0.2);
    expect(dockRatioFromDrag(0.4, 10, 80, 0)).toBe(0.4);
  });
});
