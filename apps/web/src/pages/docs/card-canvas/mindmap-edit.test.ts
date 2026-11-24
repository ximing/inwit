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
  placeGroupFromDrop,
  planGroupPlace,
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

describe('group drag', () => {
  // a ── d        b        c
  const groupNodes: OutlineNode[] = [
    { id: 'a', parentId: null, position: 0 },
    { id: 'b', parentId: null, position: 1 },
    { id: 'c', parentId: null, position: 2 },
    { id: 'd', parentId: 'a', position: 0 },
  ];

  it('counts the sibling index with the whole group removed', () => {
    expect(placeGroupFromDrop(groupNodes, ['a', 'b'], { kind: 'before', siblingId: 'c' })).toEqual({
      parentId: null,
      index: 0,
    });
    expect(placeGroupFromDrop(groupNodes, ['a', 'b'], { kind: 'after', siblingId: 'c' })).toEqual({
      parentId: null,
      index: 1,
    });
  });

  it('appends to the child list and refuses a drop inside the group', () => {
    expect(placeGroupFromDrop(groupNodes, ['b', 'c'], { kind: 'child', parentId: 'a' })).toEqual({
      parentId: 'a',
      index: 1,
    });
    expect(placeGroupFromDrop(groupNodes, ['a', 'b'], { kind: 'child', parentId: 'a' })).toBeNull();
    expect(placeGroupFromDrop(groupNodes, ['a', 'b'], { kind: 'after', siblingId: 'a' })).toBeNull();
  });

  it('appends to the roots on empty space, unless everything is already a root', () => {
    expect(placeGroupFromDrop(groupNodes, ['a', 'b'], { kind: 'root' })).toBeNull();
    expect(placeGroupFromDrop(groupNodes, ['b', 'd'], { kind: 'root' })).toEqual({
      parentId: null,
      index: 2,
    });
  });

  it('verifies each topmost node and reports an unchanged drop', () => {
    expect(planGroupPlace(groupNodes, ['a', 'b'], { parentId: null, index: 0 })).toEqual({
      ok: true,
      unchanged: true,
    });
    const moved = planGroupPlace(groupNodes, ['b', 'c'], { parentId: 'a', index: 1 });
    expect(moved).toEqual({ ok: true, unchanged: false });
  });

  it('cancels the whole group when one node would go too deep', () => {
    const deep: OutlineNode[] = [
      { id: 'n1', parentId: null, position: 0 },
      { id: 'n2', parentId: 'n1', position: 0 },
      { id: 'n3', parentId: 'n2', position: 0 },
      { id: 'n4', parentId: 'n3', position: 0 },
      { id: 'n5', parentId: 'n4', position: 0 },
      { id: 'n6', parentId: 'n5', position: 0 },
      { id: 'n7', parentId: 'n6', position: 0 },
      { id: 'n8', parentId: 'n7', position: 0 },
      { id: 'free', parentId: null, position: 1 },
    ];
    expect(planGroupPlace(deep, ['free'], { parentId: 'n8', index: 0 })).toEqual({
      ok: false,
      reason: 'depth',
    });
    expect(planGroupPlace(deep, ['n2'], { parentId: 'n3', index: 0 })).toEqual({
      ok: false,
      reason: 'cycle',
    });
  });
});
