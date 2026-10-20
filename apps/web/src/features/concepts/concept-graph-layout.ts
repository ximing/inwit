import type { Concept, ConceptRelation } from '@inwit/dto';

/**
 * 概念图布局：一般有向图（允许环）。节点是按名称收缩的单行标签，
 * 已有坐标保持不动；只有新节点才播种并松弛。
 */

export interface GraphLayoutNode {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  /** 画在标签上的文字，过长时带省略号。 */
  label: string;
}

export interface ConceptGraphLayout {
  nodes: GraphLayoutNode[];
  width: number;
  height: number;
}

export const CONCEPT_NODE_HEIGHT = 28;
const NODE_H = CONCEPT_NODE_HEIGHT;
const PAD_X = 10;
const MIN_W = 44;
/** 大约二十个汉字，再长才省略。短名称会收窄，不再占满固定卡片。 */
const MAX_LABEL_PX = 13.2 * 20;
const CJK_W = 13.2;
const LATIN_W = 7.4;
const GAP_X = 28;
const GAP_Y = 18;
const RELAX_ROUNDS = 36;
const PUSH_ROUNDS = 48;
const OVERLAP_PAD = 8;

function charWidth(ch: string): number {
  const code = ch.codePointAt(0) ?? 0;
  return code <= 0xff ? LATIN_W : CJK_W;
}

/** 标签宽度与实际绘制的文字。布局和渲染共用，避免盒子和文字不一致。 */
export function conceptNodeMetrics(name: string): { width: number; height: number; label: string } {
  const raw = name.trim();
  const chars = Array.from(raw);
  let used = 0;
  let count = chars.length;
  for (let index = 0; index < chars.length; index += 1) {
    const width = charWidth(chars[index]!);
    if (used + width > MAX_LABEL_PX) {
      count = index;
      break;
    }
    used += width;
  }
  let label = chars.slice(0, count).join('');
  if (count < chars.length) {
    let kept = 0;
    let width = 0;
    for (const ch of chars) {
      const next = charWidth(ch);
      if (width + next + CJK_W > MAX_LABEL_PX) break;
      width += next;
      kept += 1;
    }
    label = `${chars.slice(0, Math.max(1, kept)).join('')}…`;
  }
  const textW = Array.from(label).reduce((sum, ch) => sum + charWidth(ch), 0);
  return {
    width: Math.max(MIN_W, Math.ceil(textW + PAD_X * 2)),
    height: NODE_H,
    label,
  };
}

/** 节点多或关系多时，平时不画谓词，避免字压在线上。 */
export function conceptGraphIsDense(nodeCount: number, edgeCount: number): boolean {
  return nodeCount > 14 || edgeCount > 16;
}

export function showConceptEdgeLabel(input: {
  dense: boolean;
  zoom: number;
  selected: boolean;
  highlighted: boolean;
}): boolean {
  if (input.selected || input.highlighted) return true;
  if (!input.dense) return true;
  return input.zoom >= 1.2;
}

function seedPositions(
  items: readonly { id: string; width: number }[],
): Map<string, { x: number; y: number }> {
  const positions = new Map<string, { x: number; y: number }>();
  const cols = Math.max(1, Math.ceil(Math.sqrt(items.length)));
  let x = 32;
  let y = 32;
  let rowWidth = 0;
  items.forEach((item, index) => {
    const col = index % cols;
    if (col === 0) {
      x = 32 + (Math.floor(index / cols) % 2) * 16;
      if (index > 0) y += NODE_H + GAP_Y;
      rowWidth = 0;
    }
    positions.set(item.id, { x: x + rowWidth, y });
    rowWidth += item.width + GAP_X;
  });
  return positions;
}

function overlapAmount(
  a: { x: number; y: number; width: number; height: number },
  b: { x: number; y: number; width: number; height: number },
): { x: number; y: number } | null {
  const overlapX = (a.width + b.width) / 2 + OVERLAP_PAD - Math.abs(a.x + a.width / 2 - (b.x + b.width / 2));
  const overlapY = (a.height + b.height) / 2 + OVERLAP_PAD - Math.abs(a.y + a.height / 2 - (b.y + b.height / 2));
  if (overlapX <= 0 || overlapY <= 0) return null;
  return { x: overlapX, y: overlapY };
}

function boxesOverlap(a: GraphLayoutNode, b: GraphLayoutNode): boolean {
  return overlapAmount(a, b) != null;
}

/**
 * 布局：已有位置保留；新节点按实际宽度排开；松弛只移动新节点。
 * 全部节点都有历史位置时不做松弛（拖动时每帧都会进来）。
 */
export function layoutConceptGraph(
  concepts: readonly (Pick<Concept, 'id'> & { name?: string })[],
  relations: readonly Pick<ConceptRelation, 'fromConceptId' | 'toConceptId'>[],
  previousPositions?: ReadonlyMap<string, { x: number; y: number }>,
): ConceptGraphLayout {
  const metrics = new Map(concepts.map((concept) => [concept.id, conceptNodeMetrics(concept.name ?? '')]));
  const ids = concepts.map((concept) => concept.id);
  const seeded = seedPositions(ids.map((id) => ({ id, width: metrics.get(id)!.width })));
  const positions = new Map<string, { x: number; y: number }>();
  for (const id of ids) {
    const previous = previousPositions?.get(id);
    positions.set(id, previous ? { x: previous.x, y: previous.y } : seeded.get(id)!);
  }

  const pinned = new Set<string>();
  for (const id of ids) {
    if (previousPositions?.has(id)) pinned.add(id);
  }
  const movable = ids.filter((id) => !pinned.has(id));

  if (movable.length > 0) {
    const idSet = new Set(ids);
    const edges = relations.filter(
      (relation) => idSet.has(relation.fromConceptId) && idSet.has(relation.toConceptId),
    );
    const widths = new Map(ids.map((id) => [id, metrics.get(id)!.width]));

    for (let round = 0; round < RELAX_ROUNDS; round += 1) {
      const delta = new Map<string, { x: number; y: number }>();
      for (const id of movable) delta.set(id, { x: 0, y: 0 });
      for (const edge of edges) {
        const from = positions.get(edge.fromConceptId)!;
        const to = positions.get(edge.toConceptId)!;
        const fromW = widths.get(edge.fromConceptId)!;
        const toW = widths.get(edge.toConceptId)!;
        const dx = to.x + toW / 2 - (from.x + fromW / 2);
        const dy = to.y + NODE_H / 2 - (from.y + NODE_H / 2);
        const dist = Math.max(1, Math.hypot(dx, dy));
        const target = (fromW + toW) / 2 + GAP_X + 16;
        const pull = (dist - target) * 0.045;
        const ux = dx / dist;
        const uy = dy / dist;
        const fromDelta = delta.get(edge.fromConceptId);
        const toDelta = delta.get(edge.toConceptId);
        if (fromDelta) {
          fromDelta.x += ux * pull;
          fromDelta.y += uy * pull * 0.55;
        }
        if (toDelta) {
          toDelta.x -= ux * pull;
          toDelta.y -= uy * pull * 0.55;
        }
      }
      for (const id of movable) {
        const d = delta.get(id)!;
        const current = positions.get(id)!;
        positions.set(id, { x: current.x + d.x, y: current.y + d.y });
      }
    }

    for (let round = 0; round < PUSH_ROUNDS; round += 1) {
      let moved = false;
      for (let i = 0; i < ids.length; i += 1) {
        for (let j = i + 1; j < ids.length; j += 1) {
          const aId = ids[i]!;
          const bId = ids[j]!;
          const aPin = pinned.has(aId);
          const bPin = pinned.has(bId);
          if (aPin && bPin) continue;
          const a = positions.get(aId)!;
          const b = positions.get(bId)!;
          const aw = widths.get(aId)!;
          const bw = widths.get(bId)!;
          const hit = overlapAmount(
            { x: a.x, y: a.y, width: aw, height: NODE_H },
            { x: b.x, y: b.y, width: bw, height: NODE_H },
          );
          if (!hit) continue;
          const aCx = a.x + aw / 2;
          const bCx = b.x + bw / 2;
          const aCy = a.y + NODE_H / 2;
          const bCy = b.y + NODE_H / 2;
          let px = 0;
          let py = 0;
          if (hit.x < hit.y) {
            px = (bCx >= aCx ? 1 : -1) * (hit.x + 0.5);
          } else {
            py = (bCy >= aCy ? 1 : -1) * (hit.y + 0.5);
          }
          if (aPin) {
            positions.set(bId, { x: b.x + px, y: b.y + py });
          } else if (bPin) {
            positions.set(aId, { x: a.x - px, y: a.y - py });
          } else {
            positions.set(aId, { x: a.x - px / 2, y: a.y - py / 2 });
            positions.set(bId, { x: b.x + px / 2, y: b.y + py / 2 });
          }
          moved = true;
        }
      }
      if (!moved) break;
    }
  }

  const nodes = ids.map((id) => {
    const metric = metrics.get(id)!;
    const pos = positions.get(id)!;
    return { id, x: pos.x, y: pos.y, width: metric.width, height: metric.height, label: metric.label };
  });
  const maxX = nodes.reduce((max, node) => Math.max(max, node.x + node.width), 0) + 36;
  const maxY = nodes.reduce((max, node) => Math.max(max, node.y + node.height), 0) + 36;
  // 画布贴着内容，避免少数节点缩在一大块空白的左上角。
  return { nodes, width: Math.max(200, maxX), height: Math.max(140, maxY) };
}

/** 两个节点盒是否重叠（含间距）。 */
export function layoutHasOverlap(layout: ConceptGraphLayout): boolean {
  for (let i = 0; i < layout.nodes.length; i += 1) {
    for (let j = i + 1; j < layout.nodes.length; j += 1) {
      if (boxesOverlap(layout.nodes[i]!, layout.nodes[j]!)) return true;
    }
  }
  return false;
}
