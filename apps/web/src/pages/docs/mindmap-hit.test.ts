import { describe, expect, it } from 'vitest';
import { hitCardBox, hitMindDrop } from './mindmap-hit';
import type { MindBox } from './mindmap-layout';

const boxes: MindBox[] = [
  { id: 'a', x: 0, y: 0, width: 100, height: 100 },
  { id: 'b', x: 0, y: 122, width: 100, height: 100 },
];

describe('hitMindDrop', () => {
  it('uses the middle of a node as a child drop and the edges as insert lines', () => {
    expect(hitMindDrop(boxes, 40, 50, 'drag')).toEqual({ kind: 'child', parentId: 'a' });
    expect(hitMindDrop(boxes, 40, 10, 'drag')).toEqual({ kind: 'before', siblingId: 'a' });
    expect(hitMindDrop(boxes, 40, 90, 'drag')).toEqual({ kind: 'after', siblingId: 'a' });
  });

  it('treats the gap between nodes as an insert line, and empty space as a new root', () => {
    expect(hitMindDrop(boxes, 40, 110, 'drag')).toEqual({ kind: 'after', siblingId: 'a' });
    expect(hitMindDrop(boxes, 40, 116, 'drag')).toEqual({ kind: 'before', siblingId: 'b' });
    expect(hitMindDrop(boxes, 400, 40, 'drag')).toEqual({ kind: 'root' });
  });

  it('ignores the node being dragged', () => {
    expect(hitMindDrop(boxes, 40, 50, 'a')).toEqual({ kind: 'root' });
  });
});

describe('hitMindDrop with a dragged set', () => {
  it('ignores every node in the dragged group', () => {
    expect(hitMindDrop(boxes, 40, 50, new Set(['a', 'b']))).toEqual({ kind: 'root' });
    expect(hitMindDrop(boxes, 40, 50, new Set(['b']))).toEqual({ kind: 'child', parentId: 'a' });
  });
});

describe('hitCardBox', () => {
  it('hits only card boxes, never the source itself', () => {
    const cardIds = new Set(['a']);
    expect(hitCardBox(boxes, 40, 50, 'from', cardIds)).toBe('a');
    expect(hitCardBox(boxes, 40, 50, 'a', cardIds)).toBeNull();
    // b 是文本节点，不是合法落点
    expect(hitCardBox(boxes, 40, 172, 'from', cardIds)).toBeNull();
    expect(hitCardBox(boxes, 400, 40, 'from', cardIds)).toBeNull();
  });
});
