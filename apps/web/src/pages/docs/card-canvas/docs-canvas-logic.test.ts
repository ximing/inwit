import type { CanvasMember, CanvasNode, Card, DocumentCard } from '@inwit/dto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/api/client';
import {
  applyCanvasDetach,
  applyCanvasMoves,
  asDocumentCard,
  cardsAfterDetach,
  cardsAfterMoves,
  clipReason,
  decisionError,
  forestOf,
  memberStub,
  upsertCanvas,
} from './docs-canvas-logic.js';

const NOW = '2026-10-22T08:00:00.000Z';
const DOC = 'doc-1';
const USER = 'user-1';

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(NOW));
});

afterEach(() => {
  vi.useRealTimers();
});

function card(partial: Partial<Card> & Pick<Card, 'id'>): Card {
  return {
    userId: USER,
    documentId: DOC,
    topicId: null,
    mapNodeId: null,
    outlineParentId: null,
    outlinePosition: 0,
    concept: '概念',
    example: '',
    confusionPoint: '',
    tags: [],
    source: 'manual',
    acceptance: 'accepted',
    rejectReason: null,
    reviewRevision: null,
    anchorText: null,
    anchorBlockIndex: null,
    hasImage: false,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    deletedAt: null,
    ...partial,
  };
}

function docCard(partial: Partial<DocumentCard> & Pick<DocumentCard, 'id'>): DocumentCard {
  return {
    ...card(partial),
    questions: [],
    review: null,
    ...partial,
  };
}

function node(partial: Pick<CanvasNode, 'id' | 'kind'> & Partial<CanvasNode>): CanvasNode {
  return {
    documentId: DOC,
    cardId: partial.kind === 'card' ? partial.id : null,
    annotationId: partial.kind === 'annotation' ? partial.id : null,
    text: partial.kind === 'text' ? '一句' : null,
    imageKey: null,
    parentId: null,
    position: 0,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...partial,
  };
}

describe('asDocumentCard', () => {
  it('keeps the card fields and fills an empty question list plus a fresh review', () => {
    const source = card({ id: 'card-1', concept: '偏差', outlineParentId: 'parent', outlinePosition: 2 });
    expect(asDocumentCard(source)).toEqual({
      ...source,
      questions: [],
      review: { dueAt: NOW, intervalDays: 0, suspendedAt: null },
    });
  });
});

describe('memberStub', () => {
  it('points a card or annotation at its own id and leaves text and image empty', () => {
    const cardMember: CanvasMember = { id: 'card-1', kind: 'card', parentId: 'root', position: 3 };
    const noteMember: CanvasMember = { id: 'note-1', kind: 'annotation', parentId: null, position: 1 };
    const textMember: CanvasMember = { id: 'text-1', kind: 'text', parentId: 'card-1', position: 0 };
    expect(memberStub(DOC, cardMember, 'root', 3)).toEqual({
      id: 'card-1',
      documentId: DOC,
      kind: 'card',
      cardId: 'card-1',
      annotationId: null,
      text: null,
      imageKey: null,
      parentId: 'root',
      position: 3,
      createdAt: NOW,
      updatedAt: NOW,
    });
    expect(memberStub(DOC, noteMember, null, 1)).toMatchObject({
      kind: 'annotation',
      cardId: null,
      annotationId: 'note-1',
      text: null,
      imageKey: null,
    });
    expect(memberStub(DOC, textMember, 'card-1', 0)).toMatchObject({
      kind: 'text',
      cardId: null,
      annotationId: null,
      text: null,
      imageKey: null,
    });
  });
});

describe('upsertCanvas', () => {
  it('appends a new row and replaces an existing row without mutating the input', () => {
    const first = node({ id: 'a', kind: 'text', text: '甲' });
    const second = node({ id: 'b', kind: 'text', text: '乙', position: 1 });
    const nodes = [first, second];
    const appended = upsertCanvas(nodes, node({ id: 'c', kind: 'image', imageKey: 'img' }));
    expect(appended.map((item) => item.id)).toEqual(['a', 'b', 'c']);
    expect(nodes).toHaveLength(2);

    const replaced = upsertCanvas(nodes, { ...second, text: '改', position: 4 });
    expect(replaced.map((item) => [item.id, item.position, item.text])).toEqual([
      ['a', 0, '甲'],
      ['b', 4, '改'],
    ]);
    expect(nodes[1]).toBe(second);
    expect(second.text).toBe('乙');
  });
});

describe('forestOf', () => {
  it('keeps listed cards and notes, drops an unlisted card row, and lifts a missing parent', () => {
    const nodes = [
      node({ id: 'card-kept', kind: 'card', parentId: 'missing', position: 4 }),
      node({ id: 'card-dropped', kind: 'card', parentId: null, position: 1 }),
      node({ id: 'text-1', kind: 'text', parentId: 'card-kept', position: 0, text: '章' }),
    ];
    const forest = forestOf([{ id: 'card-kept' }], [{ id: 'note-1' }], nodes);
    expect(forest.map((item) => item.id).sort()).toEqual(['card-kept', 'note-1', 'text-1']);
    expect(forest.find((item) => item.id === 'card-kept')).toMatchObject({ parentId: null, position: 4 });
    expect(forest.find((item) => item.id === 'note-1')).toEqual({
      id: 'note-1',
      kind: 'annotation',
      parentId: null,
      position: 0,
    });
    expect(forest.find((item) => item.id === 'text-1')).toMatchObject({ parentId: 'card-kept', position: 0 });
  });
});

describe('detach', () => {
  it('promotes direct children after existing roots and leaves grandchildren on their parent', () => {
    const nodes = [
      node({ id: 'card-a', kind: 'card', parentId: null, position: 0 }),
      node({ id: 'text-t', kind: 'text', parentId: null, position: 2, text: '章' }),
      node({
        id: 'card-b',
        kind: 'card',
        parentId: 'card-a',
        position: 0,
        updatedAt: '2020-02-01T00:00:00.000Z',
      }),
      node({ id: 'note-n', kind: 'annotation', parentId: 'card-a', position: 1 }),
      node({ id: 'card-c', kind: 'card', parentId: 'card-b', position: 0 }),
    ];
    const grandchild = docCard({ id: 'card-c', outlineParentId: 'card-b', outlinePosition: 0, concept: '孙' });
    const bystander = docCard({ id: 'other', outlineParentId: null, outlinePosition: 9, concept: '旁' });
    const cards = [
      docCard({ id: 'card-a', outlineParentId: null, outlinePosition: 0 }),
      docCard({ id: 'card-b', outlineParentId: 'card-a', outlinePosition: 0, concept: '子' }),
      grandchild,
      bystander,
    ];
    const forest = forestOf(cards, [{ id: 'note-n' }], nodes);
    const nextNodes = applyCanvasDetach(nodes, forest, 'card-a', DOC);
    const nextCards = cardsAfterDetach(cards, forest, 'card-a');

    expect(nextNodes.find((item) => item.id === 'card-a')).toEqual(nodes[0]);
    expect(nextNodes.find((item) => item.id === 'text-t')).toEqual(nodes[1]);
    expect(nextNodes.find((item) => item.id === 'card-b')).toMatchObject({
      parentId: null,
      position: 3,
      updatedAt: '2020-02-01T00:00:00.000Z',
    });
    expect(nextNodes.find((item) => item.id === 'note-n')).toMatchObject({ parentId: null, position: 4 });
    expect(nextNodes.find((item) => item.id === 'card-c')).toMatchObject({ parentId: 'card-b', position: 0 });
    expect(nodes[2]?.parentId).toBe('card-a');

    expect(nextCards.map((item) => item.id)).toEqual(['card-b', 'card-c', 'other']);
    expect(nextCards[0]).toMatchObject({ outlineParentId: null, outlinePosition: 3, concept: '子' });
    expect(nextCards[1]).toBe(grandchild);
    expect(nextCards[2]).toBe(bystander);
    expect(cards.map((item) => item.id)).toEqual(['card-a', 'card-b', 'card-c', 'other']);
  });

  it('orders same-position children by id and still drops a card that has no forest row', () => {
    const nodes = [
      node({ id: 'card-p', kind: 'card', position: 0 }),
      node({ id: 'card-z', kind: 'card', parentId: 'card-p', position: 0 }),
      node({ id: 'card-a', kind: 'card', parentId: 'card-p', position: 0 }),
    ];
    const gone = docCard({ id: 'card-gone', outlineParentId: 'card-p', outlinePosition: 7 });
    const cards = [
      docCard({ id: 'card-p' }),
      docCard({ id: 'card-z', outlineParentId: 'card-p' }),
      docCard({ id: 'card-a', outlineParentId: 'card-p' }),
      gone,
    ];
    const forest = forestOf(
      cards.filter((item) => item.id !== 'card-gone'),
      [],
      nodes,
    );
    const next = cardsAfterDetach(cards, forest, 'card-p');
    expect(next.map((item) => [item.id, item.outlineParentId, item.outlinePosition])).toEqual([
      ['card-z', null, 1],
      ['card-a', null, 0],
      ['card-gone', 'card-p', 7],
    ]);
    expect(next[2]).toBe(gone);

    const lone = [docCard({ id: 'card-a' }), docCard({ id: 'card-b' })];
    const emptyForest = forestOf([], [], [node({ id: 'text-t', kind: 'text' })]);
    const dropped = cardsAfterDetach(lone, emptyForest, 'card-a');
    expect(dropped.map((item) => item.id)).toEqual(['card-b']);
    expect(dropped[0]).toBe(lone[1]);
  });

  it('returns the original node list when nothing moves', () => {
    const textNode = node({ id: 'text-t', kind: 'text' });
    const nodes = [textNode];
    const forest = forestOf([], [], nodes);
    expect(applyCanvasDetach(nodes, forest, 'missing', DOC)).toBe(nodes);
  });

  it('stubs a child that is in the forest but has no canvas row', () => {
    const parent = node({ id: 'card-a', kind: 'card', position: 0 });
    const forest: CanvasMember[] = [
      { id: 'card-a', kind: 'card', parentId: null, position: 0 },
      { id: 'card-b', kind: 'card', parentId: 'card-a', position: 0 },
      { id: 'note-n', kind: 'annotation', parentId: 'card-a', position: 1 },
    ];
    const next = applyCanvasDetach([parent], forest, 'card-a', DOC);
    expect(next[0]).toBe(parent);
    expect(next.slice(1)).toEqual([
      {
        id: 'card-b',
        documentId: DOC,
        kind: 'card',
        cardId: 'card-b',
        annotationId: null,
        text: null,
        imageKey: null,
        parentId: null,
        position: 0,
        createdAt: NOW,
        updatedAt: NOW,
      },
      {
        id: 'note-n',
        documentId: DOC,
        kind: 'annotation',
        cardId: null,
        annotationId: 'note-n',
        text: null,
        imageKey: null,
        parentId: null,
        position: 1,
        createdAt: NOW,
        updatedAt: NOW,
      },
    ]);
  });
});

describe('moves', () => {
  it('updates rows in order, skips unknown members, and writes card parents only', () => {
    const root = node({ id: 'card-root', kind: 'card', position: 0 });
    const text = node({ id: 'text-t', kind: 'text', text: '章', position: 1 });
    const child = node({ id: 'card-c', kind: 'card', position: 2, updatedAt: '2020-03-01T00:00:00.000Z' });
    const note = node({ id: 'note-n', kind: 'annotation', position: 3 });
    const nodes = [root, text, child, note];
    const forest: CanvasMember[] = [
      { id: 'card-root', kind: 'card', parentId: null, position: 0 },
      { id: 'text-t', kind: 'text', parentId: null, position: 1 },
      { id: 'card-c', kind: 'card', parentId: null, position: 2 },
      { id: 'note-n', kind: 'annotation', parentId: null, position: 3 },
      { id: 'card-new', kind: 'card', parentId: null, position: 0 },
    ];
    const kept = docCard({ id: 'card-root' });
    const moving = docCard({ id: 'card-c', outlineParentId: null, outlinePosition: 2 });
    const cards = [kept, moving];

    expect(applyCanvasMoves(nodes, forest, [], DOC)).toBe(nodes);

    const next = applyCanvasMoves(
      nodes,
      forest,
      [
        { id: 'ghost', parentId: null, position: 9 },
        { id: 'card-c', parentId: null, position: 1 },
        { id: 'card-c', parentId: 'text-t', position: 0 },
        { id: 'card-new', parentId: 'card-root', position: 1 },
      ],
      DOC,
    );
    expect(nodes[2]).toBe(child);
    expect(next.find((item) => item.id === 'card-c')).toMatchObject({
      parentId: 'text-t',
      position: 0,
      updatedAt: '2020-03-01T00:00:00.000Z',
    });
    expect(next.find((item) => item.id === 'ghost')).toBeUndefined();
    expect(next.find((item) => item.id === 'card-new')).toMatchObject({
      kind: 'card',
      cardId: 'card-new',
      annotationId: null,
      text: null,
      imageKey: null,
      parentId: 'card-root',
      position: 1,
      createdAt: NOW,
      updatedAt: NOW,
    });

    const underText = cardsAfterMoves(cards, forest, [{ id: 'card-c', parentId: 'text-t', position: 0 }]);
    expect(underText[0]).toBe(kept);
    expect(underText[1]).toMatchObject({ outlineParentId: null, outlinePosition: 0 });

    const underCard = cardsAfterMoves(cards, forest, [{ id: 'card-c', parentId: 'card-root', position: 2 }]);
    expect(underCard[1]).toMatchObject({ outlineParentId: 'card-root', outlinePosition: 2 });

    const underNote = cardsAfterMoves(cards, forest, [{ id: 'card-c', parentId: 'note-n', position: 5 }]);
    expect(underNote[1]).toMatchObject({ outlineParentId: null, outlinePosition: 5 });

    const missingParent = cardsAfterMoves(cards, forest, [{ id: 'card-c', parentId: 'gone', position: 6 }]);
    expect(missingParent[1]).toMatchObject({ outlineParentId: null, outlinePosition: 6 });

    const lastWins = cardsAfterMoves(cards, forest, [
      { id: 'card-c', parentId: null, position: 1 },
      { id: 'card-c', parentId: 'card-root', position: 4 },
    ]);
    expect(lastWins[1]).toMatchObject({ outlineParentId: 'card-root', outlinePosition: 4 });
  });
});

describe('clipReason', () => {
  it('strips NUL and cuts at 500 code points without splitting an emoji', () => {
    expect(clipReason('a\0b\0')).toBe('ab');
    expect(clipReason('\0'.repeat(10) + '测'.repeat(500) + '尾')).toBe('测'.repeat(500));
    expect(clipReason('测'.repeat(500))).toBe('测'.repeat(500));
    expect(clipReason('a'.repeat(499) + '😀' + 'z')).toBe('a'.repeat(499) + '😀');
    expect([...clipReason('😀'.repeat(501))]).toHaveLength(500);
  });
});

describe('decisionError', () => {
  it('keeps the fixed card-decision copy and otherwise uses the error message', () => {
    expect(decisionError(new ApiError(500, 'CARD_INDEX_FAILED', '原始信息'), 'accept')).toBe(
      '这张卡暂时没能进入检索，请再试',
    );
    expect(decisionError(new ApiError(500, 'CARD_INDEX_FAILED', '原始信息'), 'reject')).toBe(
      '这张卡暂时没能移出检索，请再试',
    );
    expect(decisionError(new ApiError(409, 'DIGEST_IN_PROGRESS', '原始信息'), 'reject')).toBe(
      '消化还在进行，暂时不能确认',
    );
    expect(decisionError(new ApiError(409, 'CARD_ALREADY_REVIEWED', '原始信息'), 'accept')).toBe(
      '请用回收站，而不是「有问题」',
    );
    expect(decisionError(new ApiError(400, 'OTHER', '服务端拒绝了'), 'accept')).toBe('服务端拒绝了');
    expect(decisionError(new Error('网络断了'), 'reject')).toBe('网络断了');
    expect(decisionError(new Error(''), 'accept')).toBe('操作没成功');
    expect(decisionError('nope', 'accept')).toBe('操作没成功');
    expect(decisionError(null, 'reject')).toBe('操作没成功');
  });
});
