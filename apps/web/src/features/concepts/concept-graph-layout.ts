import type { Concept, ConceptRelation } from '@inwit/dto';

/**
 * 概念图布局（T8）：一般有向图（允许环），网格播种 + 迭代松弛；
 * 增量更新尽量保留已有节点位置（previousPositions 优先）。
 */

export interface GraphLayoutNode {
  id: string;
  x: number;
  y: number;
}

export interface ConceptGraphLayout {
  nodes: GraphLayoutNode[];
  width: number;
  height: number;
}

const NODE_W = 148;
const NODE_H = 56;
const GAP_X = 96;
const GAP_Y = 84;
const RELAX_ROUNDS = 120;
const OVERLAP_PAD = 16;

function seedPositions(ids: string[]): Map<string, { x: number; y: number }> {
  const positions = new Map<string, { x: number; y: number }>();
  const cols = Math.max(1, Math.ceil(Math.sqrt(ids.length)));
  ids.forEach((id, index) => {
    const col = index % cols;
    const row = Math.floor(index / cols);
    positions.set(id, {
      x: 40 + col * (NODE_W + GAP_X) + (row % 2) * 36,
      y: 40 + row * (NODE_H + GAP_Y),
    });
  });
  return positions;
}

function boxesOverlap(a: GraphLayoutNode, b: GraphLayoutNode): boolean {
  return (
    Math.abs(a.x - b.x) < NODE_W + OVERLAP_PAD && Math.abs(a.y - b.y) < NODE_H + OVERLAP_PAD
  );
}

/**
 * 布局：已有位置保留；新节点网格播种；少量松弛迭代把有边节点拉近、
 * 无重叠约束拉开。不依赖外部图库。
 */
export function layoutConceptGraph(
  concepts: readonly Pick<Concept, 'id'>[],
  relations: readonly Pick<ConceptRelation, 'fromConceptId' | 'toConceptId'>[],
  previousPositions?: ReadonlyMap<string, { x: number; y: number }>,
): ConceptGraphLayout {
  const ids = concepts.map((concept) => concept.id);
  const seeded = seedPositions(ids);
  const positions = new Map<string, { x: number; y: number }>();
  for (const id of ids) {
    const previous = previousPositions?.get(id);
    positions.set(id, previous ? { x: previous.x, y: previous.y } : seeded.get(id)!);
  }

  // 新节点如果没有历史位置，放到已有节点的重心附近（避免全部叠在原点）
  const placed = [...positions.values()];
  if (placed.length > 0) {
    const cx = placed.reduce((sum, p) => sum + p.x, 0) / placed.length;
    const cy = placed.reduce((sum, p) => sum + p.y, 0) / placed.length;
    let offset = 0;
    for (const id of ids) {
      if (!previousPositions?.has(id)) {
        const current = positions.get(id)!;
        if (placed.some((p) => p !== current && Math.abs(p.x - current.x) < 1 && Math.abs(p.y - current.y) < 1)) {
          positions.set(id, { x: cx + 60 + offset * 30, y: cy + 60 + offset * 24 });
          offset += 1;
        }
      }
    }
  }

  const idSet = new Set(ids);
  const edges = relations.filter(
    (relation) => idSet.has(relation.fromConceptId) && idSet.has(relation.toConceptId),
  );
  // 有历史位置的节点固定不动（稳定旧位置）；松弛只调整新节点。
  const pinned = new Set(previousPositions?.keys() ?? []);

  for (let round = 0; round < RELAX_ROUNDS; round += 1) {
    const delta = new Map<string, { x: number; y: number }>();
    for (const id of ids) delta.set(id, { x: 0, y: 0 });

    // 边吸引：方向感上 from 在左/上，to 在右/下（弱约束，允许环）
    for (const edge of edges) {
      const from = positions.get(edge.fromConceptId)!;
      const to = positions.get(edge.toConceptId)!;
      const dx = to.x - from.x;
      const dy = to.y - from.y;
      const dist = Math.max(1, Math.hypot(dx, dy));
      const target = NODE_W + GAP_X * 1.4;
      const pull = (dist - target) * 0.02;
      const ux = dx / dist;
      const uy = dy / dist;
      delta.get(edge.fromConceptId)!.x += ux * pull;
      delta.get(edge.fromConceptId)!.y += uy * pull * 0.6;
      delta.get(edge.toConceptId)!.x -= ux * pull;
      delta.get(edge.toConceptId)!.y -= uy * pull * 0.6;
    }

    // 节点不重叠（推开）
    for (let i = 0; i < ids.length; i += 1) {
      for (let j = i + 1; j < ids.length; j += 1) {
        const a = { id: ids[i]!, ...positions.get(ids[i]!)! };
        const b = { id: ids[j]!, ...positions.get(ids[j]!)! };
        if (!boxesOverlap(a, b)) continue;
        const dx = b.x - a.x || (i % 2 === 0 ? 1 : -1);
        const dy = b.y - a.y || 1;
        const dist = Math.max(1, Math.hypot(dx, dy));
        const push = 4;
        delta.get(a.id)!.x -= (dx / dist) * push;
        delta.get(a.id)!.y -= (dy / dist) * push;
        delta.get(b.id)!.x += (dx / dist) * push;
        delta.get(b.id)!.y += (dy / dist) * push;
      }
    }

    for (const id of ids) {
      if (pinned.has(id)) continue;
      const d = delta.get(id)!;
      const current = positions.get(id)!;
      positions.set(id, { x: current.x + d.x, y: current.y + d.y });
    }
  }

  const nodes = ids.map((id) => ({ id, ...positions.get(id)! }));
  const maxX = Math.max(0, ...nodes.map((node) => node.x)) + NODE_W + 60;
  const maxY = Math.max(0, ...nodes.map((node) => node.y)) + NODE_H + 60;
  return { nodes, width: Math.max(480, maxX), height: Math.max(320, maxY) };
}

export const CONCEPT_NODE_SIZE = { width: NODE_W, height: NODE_H } as const;

/** 两个节点盒是否重叠（测试与渲染共用）。 */
export function layoutHasOverlap(layout: ConceptGraphLayout): boolean {
  for (let i = 0; i < layout.nodes.length; i += 1) {
    for (let j = i + 1; j < layout.nodes.length; j += 1) {
      if (boxesOverlap(layout.nodes[i]!, layout.nodes[j]!)) return true;
    }
  }
  return false;
}
