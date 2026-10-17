import { describe, expect, it } from 'vitest';
import { hitConceptNode } from './concept-connect.js';

const size = { width: 148, height: 56 };

describe('hitConceptNode', () => {
  const nodes = [
    { id: 'a', x: 0, y: 0 },
    { id: 'b', x: 200, y: 0 },
    { id: 'c', x: 20, y: 10 },
  ];

  it('命中节点矩形，重叠时取后绘制的节点', () => {
    expect(hitConceptNode({ x: 30, y: 20 }, nodes, size)).toBe('c');
    expect(hitConceptNode({ x: 210, y: 10 }, nodes, size)).toBe('b');
  });

  it('避开起点，空白处不命中', () => {
    expect(hitConceptNode({ x: 30, y: 20 }, nodes, size, 'a')).toBe('c');
    expect(hitConceptNode({ x: 10, y: 10 }, [nodes[0]!], size, 'a')).toBeNull();
    expect(hitConceptNode({ x: 500, y: 500 }, nodes, size)).toBeNull();
  });
});
