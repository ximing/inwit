import type { CanvasNode } from '@inwit/dto';
import { describe, expect, it } from 'vitest';
import {
  documentForest,
  forestRows,
  imageKeyFromAssetSrc,
  nodesAfterMemberLeaves,
  planForestOpen,
  planReparent,
} from './canvas-logic';

const DOC = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const CARD = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const NOTE = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const TEXT = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const IMAGE = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
const CHILD = 'ffffffff-ffff-4fff-8fff-ffffffffffff';
const GRAND = '99999999-9999-4999-8999-999999999999';

function node(partial: Pick<CanvasNode, 'id' | 'kind'> & Partial<CanvasNode>): CanvasNode {
  return {
    documentId: DOC,
    cardId: partial.kind === 'card' ? partial.id : null,
    annotationId: partial.kind === 'annotation' ? partial.id : null,
    text: partial.kind === 'text' ? '一句' : null,
    imageKey: partial.kind === 'image' ? 'users/u/img' : null,
    parentId: null,
    position: 0,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...partial,
  };
}

describe('documentForest', () => {
  it('treats a card or annotation without a canvas row as a root', () => {
    expect(documentForest([CARD], [NOTE], [])).toEqual([
      { id: CARD, kind: 'card', parentId: null, position: 0 },
      { id: NOTE, kind: 'annotation', parentId: null, position: 0 },
    ]);
  });

  it('keeps text and image nodes and lifts a parent that is not in the forest', () => {
    const forest = documentForest(
      [CARD],
      [],
      [
        node({ id: CARD, kind: 'card', parentId: 'missing-parent', position: 2 }),
        node({ id: TEXT, kind: 'text', parentId: CARD, position: 0 }),
        node({ id: IMAGE, kind: 'image', parentId: null, position: 1 }),
      ],
    );
    expect(forest.find((item) => item.id === CARD)?.parentId).toBeNull();
    expect(forest.map((item) => item.id).sort()).toEqual([CARD, IMAGE, TEXT].sort());
  });
});

describe('nodesAfterMemberLeaves', () => {
  it('promotes direct children and keeps a card row', () => {
    const nodes = [
      node({ id: CARD, kind: 'card', position: 0 }),
      node({ id: CHILD, kind: 'text', parentId: CARD, position: 0 }),
      node({ id: GRAND, kind: 'text', parentId: CHILD, position: 0 }),
    ];
    const forest = documentForest([CARD], [], nodes);
    const next = nodesAfterMemberLeaves(nodes, forest, CARD, DOC, true);
    expect(next.find((item) => item.id === CARD)).toMatchObject({ parentId: null });
    expect(next.find((item) => item.id === CHILD)?.parentId).toBeNull();
    expect(next.find((item) => item.id === GRAND)?.parentId).toBe(CHILD);
  });

  it('removes a text or image node after detaching its children', () => {
    const nodes = [
      node({ id: TEXT, kind: 'text', position: 0 }),
      node({ id: IMAGE, kind: 'image', parentId: TEXT, position: 0 }),
    ];
    const forest = documentForest([], [], nodes);
    const next = nodesAfterMemberLeaves(nodes, forest, TEXT, DOC, false);
    expect(next.map((item) => item.id)).toEqual([IMAGE]);
    expect(next[0]?.parentId).toBeNull();
  });
});

describe('forestRows and reparent', () => {
  it('indents children and refuses a cycle', () => {
    const nodes = [
      node({ id: CARD, kind: 'card', position: 0 }),
      node({ id: TEXT, kind: 'text', parentId: CARD, position: 0 }),
    ];
    const forest = documentForest([CARD], [], nodes);
    expect(forestRows(forest)).toEqual([
      { id: CARD, depth: 0, kind: 'card' },
      { id: TEXT, depth: 1, kind: 'text' },
    ]);
    expect(planReparent(forest, CARD, TEXT)).toMatchObject({ ok: false, reason: 'cycle' });
    expect(planReparent(forest, TEXT, null)).toMatchObject({ ok: true, parentId: null });
  });
});

describe('planForestOpen', () => {
  it('returns to the body anchor and keeps the sheet open', () => {
    expect(planForestOpen('card', CARD, null, false)).toEqual({
      type: 'card',
      showBody: true,
      cardId: CARD,
      reopenSheet: false,
    });
    expect(planForestOpen('annotation', NOTE, { kind: 'text', pageIndex: null }, false)).toEqual({
      type: 'annotation',
      showBody: true,
      annotationId: NOTE,
      pageIndex: null,
      keepSheet: true,
    });
    expect(planForestOpen('annotation', NOTE, { kind: 'pdf', pageIndex: 3 }, true)).toEqual({
      type: 'annotation',
      showBody: true,
      annotationId: NOTE,
      pageIndex: 3,
      keepSheet: true,
    });
    expect(planForestOpen('annotation', NOTE, { kind: 'pdf', pageIndex: 3 }, false)).toMatchObject({
      type: 'annotation',
      pageIndex: null,
      keepSheet: true,
    });
    expect(planForestOpen('text', TEXT, null, false)).toEqual({ type: 'text', nodeId: TEXT });
    expect(planForestOpen('image', IMAGE, null, false)).toEqual({ type: 'image', nodeId: IMAGE });
  });
});

describe('imageKeyFromAssetSrc', () => {
  it('strips the asset prefix', () => {
    expect(imageKeyFromAssetSrc('asset:users/u/img')).toBe('users/u/img');
    expect(imageKeyFromAssetSrc('users/u/img')).toBe('users/u/img');
  });
});
