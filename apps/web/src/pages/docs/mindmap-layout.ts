export type MindNode = {
  id: string;
  parentId: string | null;
  position: number;
  width: number;
  height: number;
};

export type MindGap = { x: number; y: number; tree: number; pad: number };

export const MIND_GAP: MindGap = { x: 56, y: 22, tree: 72, pad: 28 };

export type MindBox = { id: string; x: number; y: number; width: number; height: number };

export type MindLayout = {
  boxes: MindBox[];
  edges: Array<{ from: string; to: string }>;
  width: number;
  height: number;
};

type Measured = { w: number; h: number };

/** 沿父链走回已经走过的卡时，断开刚走的那条边，避免环把布局卡死。 */
function withoutCycles(nodes: readonly MindNode[]): MindNode[] {
  const parentOf = new Map(nodes.map((node) => [node.id, node.parentId]));
  for (const node of nodes) {
    let current: string | null = node.id;
    let prev: string | null = null;
    const seen = new Set<string>();
    while (current) {
      if (seen.has(current)) {
        if (prev) parentOf.set(prev, null);
        break;
      }
      seen.add(current);
      prev = current;
      current = parentOf.get(current) ?? null;
    }
  }
  return nodes.map((node) => ({ ...node, parentId: parentOf.get(node.id) ?? null }));
}

function compareNode(a: MindNode, b: MindNode): number {
  if (a.position !== b.position) return a.position - b.position;
  if (a.id < b.id) return -1;
  if (a.id > b.id) return 1;
  return 0;
}

/**
 * 横向脑图：兄弟从上往下叠，子树在父卡右侧，父卡相对子树垂直居中。
 * 多棵树再上下排开。父卡不在这批节点里时，该卡自己成为一棵树。
 */
export function layoutMindForest(nodes: readonly MindNode[], gap: MindGap = MIND_GAP): MindLayout {
  const ids = new Set(nodes.map((node) => node.id));
  const forest = withoutCycles(
    nodes.map((node) => ({
      ...node,
      parentId: node.parentId && ids.has(node.parentId) ? node.parentId : null,
    })),
  );
  const byId = new Map(forest.map((node) => [node.id, node]));
  const kids = new Map<string, MindNode[]>();
  for (const node of forest) {
    if (!node.parentId) continue;
    const list = kids.get(node.parentId) ?? [];
    list.push(node);
    kids.set(node.parentId, list);
  }
  for (const list of kids.values()) list.sort(compareNode);

  const measureCache = new Map<string, Measured>();
  const measure = (id: string): Measured => {
    const cached = measureCache.get(id);
    if (cached) return cached;
    const node = byId.get(id);
    if (!node) return { w: 0, h: 0 };
    const children = kids.get(id) ?? [];
    if (children.length === 0) {
      const leaf = { w: node.width, h: node.height };
      measureCache.set(id, leaf);
      return leaf;
    }
    let stack = 0;
    let childW = 0;
    for (const child of children) {
      const size = measure(child.id);
      stack += size.h;
      if (size.w > childW) childW = size.w;
    }
    stack += gap.y * (children.length - 1);
    const size = {
      w: node.width + gap.x + childW,
      h: Math.max(node.height, stack),
    };
    measureCache.set(id, size);
    return size;
  };

  const boxes: MindBox[] = [];
  const place = (id: string, x: number, top: number) => {
    const node = byId.get(id);
    if (!node) return;
    const size = measure(id);
    const children = kids.get(id) ?? [];
    boxes.push({
      id,
      x,
      y: top + (size.h - node.height) / 2,
      width: node.width,
      height: node.height,
    });
    if (children.length === 0) return;
    let stack = 0;
    const sizes = children.map((child) => measure(child.id));
    for (const size of sizes) stack += size.h;
    stack += gap.y * (children.length - 1);
    let cursor = top + (size.h - stack) / 2;
    children.forEach((child, index) => {
      const childSize = sizes[index] ?? measure(child.id);
      place(child.id, x + node.width + gap.x, cursor);
      cursor += childSize.h + gap.y;
    });
  };

  const roots = forest.filter((node) => node.parentId === null).sort(compareNode);
  let cursor = gap.pad;
  let maxW = 0;
  for (const root of roots) {
    const size = measure(root.id);
    place(root.id, gap.pad, cursor);
    if (size.w > maxW) maxW = size.w;
    cursor += size.h + gap.tree;
  }
  const height = roots.length === 0 ? gap.pad * 2 : cursor - gap.tree + gap.pad;
  const edges = forest
    .filter((node) => node.parentId)
    .map((node) => ({ from: node.parentId as string, to: node.id }));
  return {
    boxes,
    edges,
    width: maxW + gap.pad * 2,
    height,
  };
}
