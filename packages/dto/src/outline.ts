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

export type OutlineShift = { id: string; parentId: string | null; position: number };

export type OutlinePlacement =
  | {
      ok: true;
      parentId: string | null;
      /** 移走自己之后，在目标兄弟列表里的下标。 */
      index: number;
      unchanged: boolean;
      moves: OutlineShift[];
    }
  | { ok: false; reason: 'missing' | 'self' | 'cycle' | 'depth' };

function orderedSiblings(
  nodes: readonly OutlineNode[],
  parentId: string | null,
  exceptId?: string,
): OutlineNode[] {
  return nodes
    .filter((node) => node.parentId === parentId && node.id !== exceptId)
    .sort(compareNode);
}

/** 节点在兄弟里的下标。父节点按规范化之后的树计算。 */
export function outlineSlot(
  nodes: readonly OutlineNode[],
  id: string,
): { parentId: string | null; index: number } | null {
  const forest = normalize(nodes);
  const node = forest.find((item) => item.id === id);
  if (!node) return null;
  const index = orderedSiblings(forest, node.parentId).findIndex((item) => item.id === id);
  if (index < 0) return null;
  return { parentId: node.parentId, index };
}

/** 直接子节点，按现在的顺序编号。 */
export function outlineChildSlots(
  nodes: readonly OutlineNode[],
  parentId: string | null,
): Array<{ id: string; index: number }> {
  return orderedSiblings(normalize(nodes), parentId).map((node, index) => ({ id: node.id, index }));
}

/**
 * 把节点放到 parentId 下面的第 index 个位置。
 * index 是「先把这个节点从原处拿掉」之后的下标，超出则接到末尾。
 * 同一父节点下会重新排成 0、1、2…；原来的父节点如果换了，也排紧，避免出现插不进的空隙。
 */
export function planOutlinePlace(
  nodes: readonly OutlineNode[],
  nodeId: string,
  parentId: string | null,
  index: number,
): OutlinePlacement {
  const forest = normalize(nodes);
  const card = forest.find((node) => node.id === nodeId);
  if (!card) return { ok: false, reason: 'missing' };
  if (parentId === nodeId) return { ok: false, reason: 'self' };
  if (parentId !== null && !forest.some((node) => node.id === parentId)) {
    return { ok: false, reason: 'missing' };
  }
  const parentOf = parentMap(forest);
  const kids = childrenOf(forest);
  if (parentId !== null) {
    if (reaches(parentId, nodeId, parentOf)) return { ok: false, reason: 'cycle' };
    const nextDepth = depthOf(parentId, parentOf) + 1 + extraDepth(nodeId, kids);
    if (nextDepth > CARD_OUTLINE_MAX_DEPTH) return { ok: false, reason: 'depth' };
  }

  const currentIndex = orderedSiblings(forest, card.parentId).findIndex((node) => node.id === nodeId);
  const dest = orderedSiblings(forest, parentId, nodeId);
  const raw = Number.isFinite(index) ? Math.floor(index) : dest.length;
  const clamped = Math.max(0, Math.min(raw, dest.length));
  if (card.parentId === parentId && currentIndex === clamped) {
    return { ok: true, parentId, index: clamped, unchanged: true, moves: [] };
  }

  const placed = dest.map((node) => ({ id: node.id, parentId: node.parentId }));
  placed.splice(clamped, 0, { id: nodeId, parentId });
  const moves: OutlineShift[] = [];
  placed.forEach((node, position) => {
    const prev = forest.find((item) => item.id === node.id);
    if (!prev) return;
    if (prev.parentId !== node.parentId || prev.position !== position) {
      moves.push({ id: node.id, parentId: node.parentId, position });
    }
  });
  if (card.parentId !== parentId) {
    orderedSiblings(forest, card.parentId, nodeId).forEach((node, position) => {
      if (node.position !== position) {
        moves.push({ id: node.id, parentId: node.parentId, position });
      }
    });
  }
  return { ok: true, parentId, index: clamped, unchanged: false, moves };
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
