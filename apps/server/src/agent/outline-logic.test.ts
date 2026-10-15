import { describe, expect, it } from 'vitest';
import {
  OUTLINE_L1_MAX,
  OUTLINE_L2_MAX,
  OUTLINE_TOTAL_MAX,
  outlineEditsFromTree,
  type OutlineTreeNode,
} from './outline-logic.js';

function node(note: string, children?: OutlineTreeNode[]): OutlineTreeNode {
  return { note, blockIndex: 1, quote: `原文：${note}`, ...(children ? { children } : {}) };
}

describe('outlineEditsFromTree', () => {
  it('flattens a two-level tree into ordered create_highlight edits', () => {
    const plan = outlineEditsFromTree([
      node('第一章', [node('脉络一'), node('脉络二')]),
      node('第二章'),
    ]);
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    expect(plan.edits).toEqual([
      {
        op: 'create_highlight',
        ref: 's1',
        note: '第一章',
        blockIndex: 1,
        quote: '原文：第一章',
        index: 0,
        kind: 'outline',
      },
      {
        op: 'create_highlight',
        ref: 's1-1',
        note: '脉络一',
        blockIndex: 1,
        quote: '原文：脉络一',
        parentRef: 's1',
        index: 0,
        kind: 'outline',
      },
      {
        op: 'create_highlight',
        ref: 's1-2',
        note: '脉络二',
        blockIndex: 1,
        quote: '原文：脉络二',
        parentRef: 's1',
        index: 1,
        kind: 'outline',
      },
      {
        op: 'create_highlight',
        ref: 's2',
        note: '第二章',
        blockIndex: 1,
        quote: '原文：第二章',
        index: 1,
        kind: 'outline',
      },
    ]);
    expect(plan.tree).toEqual([
      { ref: 's1', childRefs: ['s1-1', 's1-2'] },
      { ref: 's2', childRefs: [] },
    ]);
  });

  it('refuses an empty tree', () => {
    expect(outlineEditsFromTree([])).toEqual({ ok: false, reason: '至少要一个大纲节点' });
  });

  it('refuses too many level-1 nodes', () => {
    const nodes = Array.from({ length: OUTLINE_L1_MAX + 1 }, (_, i) => node(`章${String(i)}`));
    const plan = outlineEditsFromTree(nodes);
    expect(plan.ok).toBe(false);
    if (plan.ok) return;
    expect(plan.reason).toContain('一级大纲节点最多');
  });

  it('refuses too many children under one node', () => {
    const children = Array.from({ length: OUTLINE_L2_MAX + 1 }, (_, i) => node(`点${String(i)}`));
    const plan = outlineEditsFromTree([node('章', children)]);
    expect(plan.ok).toBe(false);
    if (plan.ok) return;
    expect(plan.reason).toContain('二级节点');
  });

  it('refuses a third level and a tree over the total cap', () => {
    const plan = outlineEditsFromTree([node('章', [node('节', [node('小节')])])]);
    expect(plan.ok).toBe(false);
    if (plan.ok) return;
    expect(plan.reason).toBe('大纲只有两级，二级节点不能再有子节点');

    const children = Array.from({ length: OUTLINE_L2_MAX }, (_, i) => node(`点${String(i)}`));
    const count = Math.floor(OUTLINE_TOTAL_MAX / (OUTLINE_L2_MAX + 1)) + 1;
    const nodes = Array.from({ length: count }, (_, i) => node(`章${String(i)}`, children));
    const over = outlineEditsFromTree(nodes);
    expect(over.ok).toBe(false);
    if (over.ok) return;
    expect(over.reason).toContain('总数最多');
  });
});
