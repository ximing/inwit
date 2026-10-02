import {
  mergeCanvasForest,
  planOutlineDetach,
  planOutlineMove,
  type CanvasForestSource,
  type CanvasMember,
  type CanvasNode,
  type OutlineMove,
} from '@inwit/dto';

export function documentForest(
  cardIds: readonly string[],
  annotationIds: readonly string[],
  nodes: readonly CanvasForestSource[],
): CanvasMember[] {
  return mergeCanvasForest(cardIds, annotationIds, nodes);
}

export function planReparent(
  members: readonly CanvasMember[],
  nodeId: string,
  parentId: string | null,
): OutlineMove {
  return planOutlineMove(members, nodeId, parentId);
}

export type ForestRow = { id: string; depth: number; kind: CanvasMember['kind'] };

/** Roots first, then each subtree. Siblings keep position, then id. */
export function forestRows(members: readonly CanvasMember[]): ForestRow[] {
  const kids = new Map<string, CanvasMember[]>();
  const roots: CanvasMember[] = [];
  for (const member of members) {
    if (!member.parentId) roots.push(member);
    else {
      const list = kids.get(member.parentId) ?? [];
      list.push(member);
      kids.set(member.parentId, list);
    }
  }
  const byOrder = (a: CanvasMember, b: CanvasMember) => {
    if (a.position !== b.position) return a.position - b.position;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  };
  roots.sort(byOrder);
  for (const list of kids.values()) list.sort(byOrder);
  const rows: ForestRow[] = [];
  const walk = (node: CanvasMember, depth: number) => {
    rows.push({ id: node.id, depth, kind: node.kind });
    for (const child of kids.get(node.id) ?? []) walk(child, depth + 1);
  };
  for (const root of roots) walk(root, 0);
  return rows;
}

function stubNode(
  documentId: string,
  member: CanvasMember,
  parentId: string | null,
  position: number,
): CanvasNode {
  const now = new Date(0).toISOString();
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

/**
 * A card, annotation, or canvas node leaving the visible tree promotes its direct
 * children to roots. Grandchildren stay put. Card and annotation rows are kept so
 * a restore can hang them back; text and image rows are removed.
 */
export function nodesAfterMemberLeaves(
  nodes: readonly CanvasNode[],
  forest: readonly CanvasMember[],
  removedId: string,
  documentId: string,
  keepRow: boolean,
): CanvasNode[] {
  const plan = planOutlineDetach(forest, removedId);
  let next = nodes.slice();
  for (const move of plan.moves) {
    const member = forest.find((item) => item.id === move.id);
    if (!member) continue;
    const index = next.findIndex((node) => node.id === move.id);
    if (index < 0) {
      next.push(stubNode(documentId, member, move.parentId, move.position));
      continue;
    }
    const current = next[index];
    if (!current) continue;
    next[index] = { ...current, parentId: move.parentId, position: move.position };
  }
  if (!keepRow) next = next.filter((node) => node.id !== removedId);
  return next;
}

export type ForestOpenPlan =
  | { type: 'card'; showBody: true; cardId: string; reopenSheet: false }
  | {
      type: 'annotation';
      showBody: true;
      annotationId: string;
      /** Set for a PDF note so the page moves under the open sheet. */
      pageIndex: number | null;
      keepSheet: true;
    }
  | { type: 'text'; nodeId: string }
  | { type: 'image'; nodeId: string };

/** Opening a card or annotation leaves the map and uses the body anchor. The sheet stays open. */
export function planForestOpen(
  kind: CanvasMember['kind'],
  id: string,
  note: { kind: string; pageIndex: number | null } | null,
  isPdf: boolean,
): ForestOpenPlan {
  if (kind === 'card') return { type: 'card', showBody: true, cardId: id, reopenSheet: false };
  if (kind === 'annotation') {
    const pageIndex =
      isPdf && note?.kind === 'pdf' && note.pageIndex != null && note.pageIndex >= 0 ? note.pageIndex : null;
    return { type: 'annotation', showBody: true, annotationId: id, pageIndex, keepSheet: true };
  }
  if (kind === 'text') return { type: 'text', nodeId: id };
  return { type: 'image', nodeId: id };
}

export function imageKeyFromAssetSrc(src: string): string {
  const trimmed = src.trim();
  return trimmed.startsWith('asset:') ? trimmed.slice('asset:'.length) : trimmed;
}
