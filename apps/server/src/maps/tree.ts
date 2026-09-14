import type { MapNode, MapTreeNode } from '@inwit/dto';

export type MapPathNode = {
  id: string;
  title: string;
  parentId: string | null;
  path: string;
  depth: number;
  status: MapNode['status'];
  note: string | null;
  cardCount: number;
  docCount: number;
};

export function flattenMapTree(nodes: MapTreeNode[], parentTitles: string[] = []): MapPathNode[] {
  const out: MapPathNode[] = [];
  for (const node of nodes) {
    const titles = [...parentTitles, node.title];
    out.push({
      id: node.id,
      title: node.title,
      parentId: node.parentId,
      path: titles.join(' / '),
      depth: titles.length,
      status: node.status,
      note: node.note,
      cardCount: node.cardCount,
      docCount: node.docCount,
    });
    if (node.children.length > 0) {
      out.push(...flattenMapTree(node.children, titles));
    }
  }
  return out;
}

export function assembleMapTree(nodes: MapNode[]): MapTreeNode[] {
  const childrenOf = new Map<string | null, MapNode[]>();
  for (const node of nodes) {
    const list = childrenOf.get(node.parentId) ?? [];
    list.push(node);
    childrenOf.set(node.parentId, list);
  }
  for (const list of childrenOf.values()) {
    list.sort((a, b) => a.position - b.position || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  }
  const walk = (parentId: string | null): MapTreeNode[] =>
    (childrenOf.get(parentId) ?? []).map((node) => ({
      ...node,
      children: walk(node.id),
    }));
  return walk(null);
}

/** Relative height of a subtree (leaf = 0, a node with only leaves = 1). */
export function subtreeRelativeHeight(
  nodeId: string,
  childrenOf: Map<string, { id: string }[]>,
): number {
  const kids = childrenOf.get(nodeId) ?? [];
  if (kids.length === 0) return 0;
  let max = 0;
  for (const kid of kids) {
    const h = subtreeRelativeHeight(kid.id, childrenOf);
    if (h > max) max = h;
  }
  return 1 + max;
}

export function parentChainContains(
  startParentId: string | null,
  targetId: string,
  parentOf: Map<string, string | null>,
): boolean {
  let current = startParentId;
  const seen = new Set<string>();
  while (current) {
    if (current === targetId) return true;
    if (seen.has(current)) return true;
    seen.add(current);
    current = parentOf.get(current) ?? null;
  }
  return false;
}

export function depthFromRoot(
  nodeId: string,
  parentOf: Map<string, string | null>,
): number {
  let depth = 1;
  let current = parentOf.get(nodeId) ?? null;
  const seen = new Set<string>([nodeId]);
  while (current) {
    if (seen.has(current)) return depth;
    seen.add(current);
    depth += 1;
    current = parentOf.get(current) ?? null;
  }
  return depth;
}
