import { describe, expect, it } from 'vitest';
import { layoutMindForest, type MindGap, type MindNode } from './mindmap-layout';

const gap: MindGap = { x: 50, y: 10, tree: 40, pad: 0 };

function box(nodes: MindNode[], id: string) {
  const found = layoutMindForest(nodes, gap).boxes.find((item) => item.id === id);
  if (!found) throw new Error(`missing ${id}`);
  return found;
}

function overlaps(a: { x: number; y: number; width: number; height: number }, b: typeof a): boolean {
  return a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
}

describe('layoutMindForest', () => {
  it('puts a child to the right of its parent and lines up their centers', () => {
    const nodes: MindNode[] = [
      { id: 'a', parentId: null, position: 0, width: 100, height: 40 },
      { id: 'b', parentId: 'a', position: 0, width: 80, height: 40 },
    ];
    const parent = box(nodes, 'a');
    const child = box(nodes, 'b');
    expect(child.x).toBe(parent.x + parent.width + gap.x);
    expect(child.y + child.height / 2).toBe(parent.y + parent.height / 2);
  });

  it('stacks siblings from top to bottom and keeps trees from overlapping', () => {
    const nodes: MindNode[] = [
      { id: 'a', parentId: null, position: 0, width: 100, height: 20 },
      { id: 'b', parentId: 'a', position: 0, width: 60, height: 20 },
      { id: 'c', parentId: 'a', position: 1, width: 60, height: 30 },
      { id: 'd', parentId: null, position: 1, width: 100, height: 20 },
    ];
    const layout = layoutMindForest(nodes, gap);
    const b = box(nodes, 'b');
    const c = box(nodes, 'c');
    const a = box(nodes, 'a');
    const d = box(nodes, 'd');
    expect(c.y).toBeGreaterThan(b.y + b.height);
    expect(b.x).toBe(c.x);
    expect(d.x).toBe(a.x);
    expect(d.y).toBeGreaterThan(a.y + a.height);
    for (let i = 0; i < layout.boxes.length; i += 1) {
      for (let j = i + 1; j < layout.boxes.length; j += 1) {
        const left = layout.boxes[i];
        const right = layout.boxes[j];
        if (left && right) expect(overlaps(left, right)).toBe(false);
      }
    }
  });

  it('starts a new tree when the parent is not on the canvas', () => {
    const nodes: MindNode[] = [
      { id: 'a', parentId: 'gone', position: 0, width: 40, height: 20 },
      { id: 'b', parentId: null, position: 1, width: 40, height: 20 },
    ];
    const a = box(nodes, 'a');
    const b = box(nodes, 'b');
    expect(a.x).toBe(b.x);
    expect(layoutMindForest(nodes, gap).edges).toEqual([]);
  });

  it('breaks a cycle and still places every card', () => {
    const nodes: MindNode[] = [
      { id: 'a', parentId: 'b', position: 0, width: 40, height: 20 },
      { id: 'b', parentId: 'a', position: 0, width: 40, height: 20 },
    ];
    const layout = layoutMindForest(nodes, gap);
    expect(layout.boxes.map((item) => item.id).sort()).toEqual(['a', 'b']);
    expect(layout.edges).toHaveLength(1);
    const [first, second] = layout.boxes;
    if (first && second) expect(overlaps(first, second)).toBe(false);
  });
});
