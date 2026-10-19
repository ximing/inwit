import { describe, expect, it } from 'vitest';
import { layoutConceptGraph, layoutHasOverlap } from './concept-graph-layout.js';
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
