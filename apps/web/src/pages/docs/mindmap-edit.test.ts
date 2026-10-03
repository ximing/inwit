import { planOutlinePlace, type OutlineNode } from '@inwit/dto';
import { describe, expect, it } from 'vitest';
import {
  childPlace,
  foldedAway,
  foldsHiding,
  indentPlace,
  navigateMind,
  nudgePlace,
  outdentPlace,
  placeFromDrop,
  siblingInsert,
} from './mindmap-edit';

const nodes: OutlineNode[] = [
  { id: 'a', parentId: null, position: 0 },
  { id: 'b', parentId: null, position: 1 },
  { id: 'c', parentId: null, position: 2 },
  { id: 'd', parentId: 'a', position: 0 },
];

describe('mind map edits', () => {
  it('turns a before-drop into the index left after the dragged node is removed', () => {
    expect(placeFromDrop(nodes, 'c', { kind: 'before', siblingId: 'b' })).toEqual({
      parentId: null,
      index: 1,
    });
    const drop = placeFromDrop(nodes, 'c', { kind: 'before', siblingId: 'b' });
    expect(drop && planOutlinePlace(nodes, 'c', drop.parentId, drop.index)).toMatchObject({
      ok: true,
      moves: [
        { id: 'c', parentId: null, position: 1 },
        { id: 'b', parentId: null, position: 2 },
      ],
    });
  });

  it('leaves a root where it is when dropped on empty space', () => {
    expect(placeFromDrop(nodes, 'b', { kind: 'root' })).toEqual({ parentId: null, index: 1 });
    expect(placeFromDrop(nodes, 'd', { kind: 'root' })).toEqual({ parentId: null, index: 3 });
  });

  it('indents under the previous sibling, outdents beside the parent, and swaps', () => {
    expect(indentPlace(nodes, 'b')).toEqual({ parentId: 'a', index: 1 });
    expect(indentPlace(nodes, 'a')).toBeNull();
    expect(outdentPlace(nodes, 'd')).toEqual({ parentId: null, index: 1 });
    expect(nudgePlace(nodes, 'b', -1)).toEqual({ parentId: null, index: 0 });
    expect(nudgePlace(nodes, 'a', -1)).toBeNull();
    expect(siblingInsert(nodes, 'a')).toEqual({ parentId: null, index: 1 });
    expect(childPlace(nodes, 'a')).toEqual({ parentId: 'a', index: 1 });
  });

  it('folds with the left arrow before moving to the parent, and hides descendants', () => {
    expect(navigateMind(nodes, 'a', 'ArrowLeft', new Set())).toEqual({ type: 'fold' });
    expect(navigateMind(nodes, 'a', 'ArrowLeft', new Set(['a']))).toEqual({ type: 'none' });
    expect(navigateMind(nodes, 'a', 'ArrowRight', new Set(['a']))).toEqual({ type: 'unfold' });
    expect(navigateMind(nodes, 'b', 'ArrowUp', new Set())).toEqual({ type: 'select', id: 'a' });
    expect(foldedAway(nodes, new Set(['a']))).toEqual(new Set(['d']));
    expect(foldsHiding(nodes, 'd', new Set(['a']))).toEqual(['a']);
    expect(foldsHiding(nodes, 'd', new Set())).toEqual([]);
    expect(foldsHiding(nodes, 'b', new Set(['a']))).toEqual([]);
  });
});
