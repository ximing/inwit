import { ApiError, errorMessage } from '@/api/client';
import {
  mergeCanvasForest,
  planOutlineDetach,
  type CanvasMember,
  type CanvasNode,
  type Card,
  type DocumentCard,
} from '@inwit/dto';

export function asDocumentCard(card: Card): DocumentCard {
  return {
    ...card,
    questions: [],
    review: { dueAt: new Date().toISOString(), intervalDays: 0, suspendedAt: null },
  };
}

export function memberStub(
  documentId: string,
  member: CanvasMember,
  parentId: string | null,
  position: number,
): CanvasNode {
  const now = new Date().toISOString();
  return {
    id: member.id,
    documentId,
    kind: member.kind,
    cardId: member.kind === 'card' ? member.id : null,
    annotationId: member.kind === 'annotation' ? member.id : null,
    text: null,
    imageKey: null,
    parentId,
    position,
    createdAt: now,
    updatedAt: now,
  };
}

export function upsertCanvas(nodes: CanvasNode[], next: CanvasNode): CanvasNode[] {
  const index = nodes.findIndex((node) => node.id === next.id);
  if (index < 0) return [...nodes, next];
  const copy = nodes.slice();
  copy[index] = next;
  return copy;
}

export function forestOf(
  cards: readonly { id: string }[],
  notes: readonly { id: string }[],
  nodes: readonly CanvasNode[],
): CanvasMember[] {
  return mergeCanvasForest(
    cards.map((card) => card.id),
    notes.map((note) => note.id),
    nodes,
  );
}

export function applyCanvasDetach(
  nodes: CanvasNode[],
  forest: readonly CanvasMember[],
  removedId: string,
  documentId: string,
): CanvasNode[] {
  const plan = planOutlineDetach(forest, removedId);
  let next = nodes;
  for (const move of plan.moves) {
    const member = forest.find((item) => item.id === move.id);
    if (!member) continue;
    const existing = next.find((node) => node.id === move.id);
    const base = existing ?? memberStub(documentId, member, move.parentId, move.position);
    next = upsertCanvas(next, { ...base, parentId: move.parentId, position: move.position });
  }
  return next;
}

export function cardsAfterDetach(
  cards: DocumentCard[],
  forest: readonly CanvasMember[],
  removedId: string,
): DocumentCard[] {
  const plan = planOutlineDetach(forest, removedId);
  const moves = new Map(plan.moves.map((move) => [move.id, move]));
  return cards
    .filter((card) => card.id !== removedId)
    .map((card) => {
      const move = moves.get(card.id);
      if (!move) return card;
      const parent = move.parentId ? forest.find((item) => item.id === move.parentId) : null;
      return {
        ...card,
        outlineParentId: parent?.kind === 'card' ? parent.id : null,
        outlinePosition: move.position,
      };
    });
}

export function applyCanvasMoves(
  nodes: CanvasNode[],
  forest: readonly CanvasMember[],
  moves: readonly { id: string; parentId: string | null; position: number }[],
  documentId: string,
): CanvasNode[] {
  let next = nodes;
  for (const move of moves) {
    const member = forest.find((item) => item.id === move.id);
    if (!member) continue;
    const existing = next.find((node) => node.id === move.id);
    const base = existing ?? memberStub(documentId, member, move.parentId, move.position);
    next = upsertCanvas(next, { ...base, parentId: move.parentId, position: move.position });
  }
  return next;
}

export function cardsAfterMoves(
  cards: DocumentCard[],
  forest: readonly CanvasMember[],
  moves: readonly { id: string; parentId: string | null; position: number }[],
): DocumentCard[] {
  const byId = new Map(moves.map((move) => [move.id, move]));
  return cards.map((card) => {
    const move = byId.get(card.id);
    if (!move) return card;
    const parent = move.parentId ? forest.find((item) => item.id === move.parentId) : null;
    return {
      ...card,
      outlineParentId: parent?.kind === 'card' ? parent.id : null,
      outlinePosition: move.position,
    };
  });
}

export function clipReason(reason: string): string {
  const chars = [...reason.replaceAll('\0', '')];
  return chars.length <= 500 ? chars.join('') : chars.slice(0, 500).join('');
}

export function decisionError(err: unknown, action: 'accept' | 'reject'): string {
  if (err instanceof ApiError) {
    if (err.code === 'CARD_INDEX_FAILED') {
      return action === 'accept'
        ? '这张卡暂时没能进入检索，请再试'
        : '这张卡暂时没能移出检索，请再试';
    }
    if (err.code === 'DIGEST_IN_PROGRESS') return '消化还在进行，暂时不能确认';
    if (err.code === 'CARD_ALREADY_REVIEWED') return '请用回收站，而不是「有问题」';
  }
  return errorMessage(err, '操作没成功');
}
