/** 一篇文档里卡片脑图的最大层级（根为第 1 级）。 */
export const CARD_OUTLINE_MAX_DEPTH = 8;

export type OutlineNode = {
  id: string;
  parentId: string | null;
  position: number;
};

export type OutlineMove =
  | { ok: true; parentId: string | null; position: number; unchanged: boolean }
  | { ok: false; reason: 'missing' | 'self' | 'cycle' | 'depth' };

function compareNode(a: OutlineNode, b: OutlineNode): number {
  if (a.position !== b.position) return a.position - b.position;
  if (a.id < b.id) return -1;
  if (a.id > b.id) return 1;
  return 0;
}

/** 父节点不在这批卡里、或指向自己时，当作一棵独立的树。 */
function normalize(nodes: readonly OutlineNode[]): OutlineNode[] {
  const ids = new Set(nodes.map((node) => node.id));
  return nodes.map((node) => ({
    id: node.id,
    parentId:
      node.parentId && ids.has(node.parentId) && node.parentId !== node.id ? node.parentId : null,
    position: node.position,
  }));
}

function childrenOf(nodes: readonly OutlineNode[]): Map<string, OutlineNode[]> {
  const map = new Map<string, OutlineNode[]>();
  for (const node of nodes) {
    if (!node.parentId) continue;
    const list = map.get(node.parentId) ?? [];
    list.push(node);
    map.set(node.parentId, list);
  }
  for (const list of map.values()) list.sort(compareNode);
  return map;
}

function parentMap(nodes: readonly OutlineNode[]): Map<string, string | null> {
  return new Map(nodes.map((node) => [node.id, node.parentId]));
}

/** 从 start 沿父链向上，是否会走到 target（含环）。 */
function reaches(start: string | null, target: string, parentOf: Map<string, string | null>): boolean {
  let current = start;
  const seen = new Set<string>();
  while (current) {
    if (current === target) return true;
    if (seen.has(current)) return true;
    seen.add(current);
    current = parentOf.get(current) ?? null;
  }
  return false;
}

function depthOf(id: string, parentOf: Map<string, string | null>): number {
  let depth = 1;
  let current = parentOf.get(id) ?? null;
  const seen = new Set<string>([id]);
  while (current) {
    if (seen.has(current)) return CARD_OUTLINE_MAX_DEPTH + 1;
    seen.add(current);
    depth += 1;
    current = parentOf.get(current) ?? null;
  }
  return depth;
}

/** 该节点下面还有几级（叶子为 0）。 */
function extraDepth(id: string, kids: Map<string, OutlineNode[]>): number {
  const list = kids.get(id) ?? [];
  let max = 0;
  for (const child of list) {
    const below = 1 + extraDepth(child.id, kids);
    if (below > max) max = below;
  }
  return max;
}

function nextPosition(nodes: readonly OutlineNode[], parentId: string | null, exceptId: string): number {
  let max = -1;
  for (const node of nodes) {
    if (node.id === exceptId || node.parentId !== parentId) continue;
    if (node.position > max) max = node.position;
  }
  return max + 1;
}

/**
 * 把一张卡放到另一张卡下面，或 parentId 为空时独立成树。
 * 放到空白处（独立成树）不受层级上限约束，避免过深的树拆不下来。
 */
export function planOutlineMove(
  nodes: readonly OutlineNode[],
  cardId: string,
  parentId: string | null,
): OutlineMove {
  const forest = normalize(nodes);
  const card = forest.find((node) => node.id === cardId);
  if (!card) return { ok: false, reason: 'missing' };
  if (parentId === cardId) return { ok: false, reason: 'self' };
  if (parentId !== null && !forest.some((node) => node.id === parentId)) {
    return { ok: false, reason: 'missing' };
  }
  const parentOf = parentMap(forest);
  const kids = childrenOf(forest);
  if (parentId !== null) {
    if (reaches(parentId, cardId, parentOf)) return { ok: false, reason: 'cycle' };
    const nextDepth = depthOf(parentId, parentOf) + 1 + extraDepth(cardId, kids);
    if (nextDepth > CARD_OUTLINE_MAX_DEPTH) return { ok: false, reason: 'depth' };
  }
  if (card.parentId === parentId) {
    return { ok: true, parentId, position: card.position, unchanged: true };
  }
  return {
    ok: true,
    parentId,
    position: nextPosition(forest, parentId, cardId),
    unchanged: false,
  };
}

/**
 * 一个节点离开可见树（归档、拒绝、删除）时，直接子节点各自成为一棵树，
 * 排在已有的根后面，相对顺序不变。再下面的节点仍挂在原来的子节点上。
 */
export function planOutlineDetach(
  nodes: readonly OutlineNode[],
  removedId: string,
): {
  nextParent: string | null;
  moves: Array<{ id: string; parentId: string | null; position: number }>;
} {
  const forest = normalize(nodes);
  const removed = forest.find((node) => node.id === removedId);
  if (!removed) return { nextParent: null, moves: [] };
  const direct = childrenOf(forest).get(removedId) ?? [];
  const start = nextPosition(forest, null, removedId);
  return {
    nextParent: null,
    moves: direct.map((child, index) => ({
      id: child.id,
      parentId: null,
      position: start + index,
    })),
  };
}
