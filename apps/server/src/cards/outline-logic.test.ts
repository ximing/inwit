import { CARD_OUTLINE_MAX_DEPTH, planOutlineDetach, planOutlineMove, type OutlineNode } from '@inwit/dto';
import { describe, expect, it } from 'vitest';

function chain(length: number): OutlineNode[] {
  return Array.from({ length }, (_, index) => ({
    id: `n${index + 1}`,
    parentId: index === 0 ? null : `n${index}`,
    position: 0,
  }));
}

describe('planOutlineMove', () => {
  const nodes: OutlineNode[] = [
    { id: 'a', parentId: null, position: 0 },
    { id: 'b', parentId: 'a', position: 0 },
    { id: 'c', parentId: 'a', position: 1 },
    { id: 'd', parentId: null, position: 1 },
  ];

  it('appends a card under another and keeps it a root when dropped on empty space', () => {
    expect(planOutlineMove(nodes, 'd', 'b')).toEqual({
      ok: true,
      parentId: 'b',
      position: 0,
      unchanged: false,
    });
    expect(planOutlineMove(nodes, 'b', null)).toEqual({
      ok: true,
      parentId: null,
      position: 2,
      unchanged: false,
    });
  });

  it('does nothing when the card is already in that place', () => {
    const underParent = planOutlineMove(nodes, 'c', 'a');
    const alreadyRoot = planOutlineMove(nodes, 'd', null);
    expect(underParent.ok && underParent.unchanged).toBe(true);
    expect(alreadyRoot.ok && alreadyRoot.unchanged).toBe(true);
  });

  it('rejects self, missing cards, and a drop onto a descendant', () => {
    expect(planOutlineMove(nodes, 'a', 'a').ok).toBe(false);
    expect(planOutlineMove(nodes, 'missing', null)).toEqual({ ok: false, reason: 'missing' });
    expect(planOutlineMove(nodes, 'a', 'gone')).toEqual({ ok: false, reason: 'missing' });
    expect(planOutlineMove(nodes, 'a', 'c')).toEqual({ ok: false, reason: 'cycle' });
  });

  it('treats a parent that is not in the forest as its own tree', () => {
    const moved = planOutlineMove(
      [
        { id: 'a', parentId: 'ghost', position: 0 },
        { id: 'b', parentId: null, position: 4 },
      ],
      'a',
      'b',
    );
    expect(moved).toEqual({ ok: true, parentId: 'b', position: 0, unchanged: false });
  });

  it('stops at the depth cap, but still lets a deep subtree become its own tree', () => {
    const deep = chain(CARD_OUTLINE_MAX_DEPTH);
    const leaf = `n${CARD_OUTLINE_MAX_DEPTH}`;
    expect(planOutlineMove([...deep, { id: 'extra', parentId: null, position: 0 }], 'extra', leaf)).toEqual({
      ok: false,
      reason: 'depth',
    });
    const rooted = planOutlineMove(deep, leaf, null);
    expect(rooted.ok).toBe(true);
    if (rooted.ok) expect(rooted.parentId).toBeNull();
  });
});

describe('planOutlineDetach', () => {
  it('lifts children onto the grandparent, after the siblings that stay', () => {
    const nodes: OutlineNode[] = [
      { id: 'a', parentId: null, position: 0 },
      { id: 'b', parentId: 'a', position: 0 },
      { id: 'c', parentId: 'a', position: 1 },
      { id: 'd', parentId: 'b', position: 0 },
      { id: 'e', parentId: 'b', position: 2 },
    ];
    expect(planOutlineDetach(nodes, 'b')).toEqual({
      nextParent: 'a',
      moves: [
        { id: 'd', parentId: 'a', position: 2 },
        { id: 'e', parentId: 'a', position: 3 },
      ],
    });
  });

  it('turns children into their own trees when the removed card was a root', () => {
    const nodes: OutlineNode[] = [
      { id: 'a', parentId: null, position: 0 },
      { id: 'b', parentId: null, position: 3 },
      { id: 'c', parentId: 'a', position: 0 },
    ];
    expect(planOutlineDetach(nodes, 'a')).toEqual({
      nextParent: null,
      moves: [{ id: 'c', parentId: null, position: 4 }],
    });
  });
});
