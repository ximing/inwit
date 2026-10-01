import { mergeCanvasForest, planOutlineMove, type CanvasForestSource } from '@inwit/dto';
import { describe, expect, it } from 'vitest';

function card(id: string, parentId: string | null = null, position = 0): CanvasForestSource {
  return { id, kind: 'card', cardId: id, annotationId: null, parentId, position };
}

function note(id: string, parentId: string | null = null, position = 0): CanvasForestSource {
  return { id, kind: 'annotation', cardId: null, annotationId: id, parentId, position };
}

describe('mergeCanvasForest', () => {
  it('synthesizes missing cards and annotations as roots', () => {
    expect(mergeCanvasForest(['c1'], ['a1'], [])).toEqual([
      { id: 'c1', kind: 'card', parentId: null, position: 0 },
      { id: 'a1', kind: 'annotation', parentId: null, position: 0 },
    ]);
  });

  it('keeps a real parent and clears one that is not on the canvas', () => {
    const forest = mergeCanvasForest(
      ['c1', 'c2'],
      ['a1'],
      [
        card('c2', 'a1', 1),
        note('a1', 'gone', 2),
        { id: 't1', kind: 'text', cardId: null, annotationId: null, parentId: 'c1', position: 0 },
      ],
    );
    expect(forest.find((node) => node.id === 'c2')?.parentId).toBe('a1');
    expect(forest.find((node) => node.id === 'a1')?.parentId).toBeNull();
    expect(forest.find((node) => node.id === 't1')?.parentId).toBe('c1');
    expect(forest.find((node) => node.id === 'c1')?.kind).toBe('card');
  });

  it('drops hidden card rows and lets an image sit under a card', () => {
    const forest = mergeCanvasForest(
      ['c1'],
      [],
      [
        card('hidden'),
        card('c1', null, 3),
        { id: 'img1', kind: 'image', cardId: null, annotationId: null, parentId: null, position: 1 },
        { id: 'other', kind: 'card', cardId: 'c1', annotationId: null, parentId: null, position: 0 },
      ],
    );
    expect(forest.map((node) => node.id).sort()).toEqual(['c1', 'img1']);
    expect(forest.find((node) => node.id === 'c1')?.parentId).toBeNull();
    const plan = planOutlineMove(forest, 'img1', 'c1');
    expect(plan.ok && !plan.unchanged && plan.parentId).toBe('c1');
  });
});
