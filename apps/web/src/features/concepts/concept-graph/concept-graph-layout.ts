import type { Concept, ConceptRelation } from '@inwit/dto';

/**
 * 概念图布局：一般有向图（允许环）。节点是按名称收缩的单行标签。
 * 连线按谓词宽度留出空隙，关系文字才放得下。
 * 已有坐标保持不动（拖过的位置）；只有新节点才播种并松弛。
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
const GAP_X = 84;
const RELAX_ROUNDS = 80;
const PUSH_ROUNDS = 48;
const OVERLAP_PAD = 20;
/** 边上至少留出的空隙，短谓词也要能放下。 */
const EDGE_GAP = 96;
/** 谓词芯片两侧再留一点，避免贴到胶囊上。 */
const LABEL_PAD = 52;
const LABEL_CJK = 11;
const LABEL_LATIN = 6.4;
/** 超长谓词不再把整张图撑到无法概览，其余文字可以略微伸出。 */
const EDGE_GAP_CAP = LABEL_CJK * 28 + LABEL_PAD;
/** 任意两个节点之间的最小额外间距，避免邻居叠在同一条谓词上。 */
const PAIR_GAP = 64;
const STEP_LIMIT = 80;

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

/** 谓词在 11px 下的大致宽度，布局留白和芯片共用。 */
export function conceptPredicateLabelWidth(predicate: string): number {
  let width = 0;
  for (const ch of predicate.trim()) {
    const code = ch.codePointAt(0) ?? 0;
    width += code <= 0xff ? LABEL_LATIN : LABEL_CJK;
  }
  return width;
}

function edgeClearance(predicate: string | undefined): number {
  const text = predicate?.trim() ?? '';
  if (!text) return EDGE_GAP;
  return Math.min(EDGE_GAP_CAP, Math.max(EDGE_GAP, conceptPredicateLabelWidth(text) + LABEL_PAD));
}

export interface ConceptReadingFocus {
  nodeIds: Set<string>;
  edgeIds: Set<string>;
}

/**
 * 选中概念时，阅读范围是它和一级邻居，以及连到它的那些边。
 * 两个邻居之间、但不经过它的边不在阅读范围内。
 * 选中关系时只留这条边的两端。都没选中则不聚焦。
 */
export function conceptReadingFocus(input: {
  selectedConceptId: string | null;
  selectedRelation: { id: string; fromConceptId: string; toConceptId: string } | null;
  relations: readonly { id: string; fromConceptId: string; toConceptId: string }[];
}): ConceptReadingFocus | null {
  if (input.selectedConceptId) {
    const nodeIds = new Set<string>([input.selectedConceptId]);
    const edgeIds = new Set<string>();
    for (const relation of input.relations) {
      if (
        relation.fromConceptId !== input.selectedConceptId &&
        relation.toConceptId !== input.selectedConceptId
      ) {
        continue;
      }
      nodeIds.add(relation.fromConceptId);
      nodeIds.add(relation.toConceptId);
      edgeIds.add(relation.id);
    }
    return { nodeIds, edgeIds };
  }
  if (input.selectedRelation) {
    return {
      nodeIds: new Set([input.selectedRelation.fromConceptId, input.selectedRelation.toConceptId]),
      edgeIds: new Set([input.selectedRelation.id]),
    };
  }
  return null;
}

function seedPositions(
  items: readonly { id: string; width: number }[],
): Map<string, { x: number; y: number }> {
  const positions = new Map<string, { x: number; y: number }>();
  const count = items.length;
  if (count === 0) return positions;
  if (count === 1) {
    positions.set(items[0]!.id, { x: 48, y: 48 });
    return positions;
  }
  // 网格播种会把同一行节点放在同一条射线上，松弛时叠在一起。圆周上角度先分开。
  const average = items.reduce((sum, item) => sum + item.width, 0) / count;
  const radius = Math.max(160, (count * (average + Math.max(GAP_X, EDGE_GAP))) / (2 * Math.PI));
  items.forEach((item, index) => {
    const angle = -Math.PI / 2 + (index / count) * Math.PI * 2;
    const cx = radius + 64 + Math.cos(angle) * radius;
    const cy = radius + 64 + Math.sin(angle) * radius;
    positions.set(item.id, { x: cx - item.width / 2, y: cy - NODE_H / 2 });
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
  relations: readonly (Pick<ConceptRelation, 'fromConceptId' | 'toConceptId'> & { predicate?: string })[],
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
    const clearance = new Map<string, number>();
    const springEdges: { fromConceptId: string; toConceptId: string }[] = [];
    const springSeen = new Set<string>();
    for (const edge of edges) {
      const forward = `${edge.fromConceptId}\0${edge.toConceptId}`;
      const backward = `${edge.toConceptId}\0${edge.fromConceptId}`;
      const need = Math.max(
        edgeClearance(edge.predicate),
        clearance.get(forward) ?? 0,
        clearance.get(backward) ?? 0,
      );
      clearance.set(forward, need);
      clearance.set(backward, need);
      const pair = [edge.fromConceptId, edge.toConceptId].sort().join('\0');
      if (springSeen.has(pair)) continue;
      springSeen.add(pair);
      springEdges.push(edge);
    }

    const addDelta = (
      delta: Map<string, { x: number; y: number }>,
      id: string,
      x: number,
      y: number,
    ) => {
      const slot = delta.get(id);
      if (!slot) return;
      slot.x += x;
      slot.y += y;
    };

    for (let round = 0; round < RELAX_ROUNDS; round += 1) {
      const delta = new Map<string, { x: number; y: number }>();
      for (const id of movable) delta.set(id, { x: 0, y: 0 });
      for (const edge of springEdges) {
        const from = positions.get(edge.fromConceptId)!;
        const to = positions.get(edge.toConceptId)!;
        const fromW = widths.get(edge.fromConceptId)!;
        const toW = widths.get(edge.toConceptId)!;
        const dx = to.x + toW / 2 - (from.x + fromW / 2);
        const dy = to.y + NODE_H / 2 - (from.y + NODE_H / 2);
        const dist = Math.hypot(dx, dy);
        const target =
          (fromW + toW) / 2 + (clearance.get(`${edge.fromConceptId}\0${edge.toConceptId}`) ?? EDGE_GAP);
        const pull = ((dist < 1 ? 0 : dist) - target) * 0.07;
        const ux = dist < 1 ? 1 : dx / dist;
        const uy = dist < 1 ? 0 : dy / dist;
        addDelta(delta, edge.fromConceptId, ux * pull, uy * pull);
        addDelta(delta, edge.toConceptId, -ux * pull, -uy * pull);
      }
      for (let i = 0; i < ids.length; i += 1) {
        for (let j = i + 1; j < ids.length; j += 1) {
          const aId = ids[i]!;
          const bId = ids[j]!;
          if (pinned.has(aId) && pinned.has(bId)) continue;
          const a = positions.get(aId)!;
          const b = positions.get(bId)!;
          const aw = widths.get(aId)!;
          const bw = widths.get(bId)!;
          const dx = b.x + bw / 2 - (a.x + aw / 2);
          const dy = b.y + NODE_H / 2 - (a.y + NODE_H / 2);
          const dist = Math.hypot(dx, dy);
          const minDist = (aw + bw) / 2 + PAIR_GAP;
          if (dist >= minDist) continue;
          const push = (minDist - (dist < 1 ? 0 : dist)) * 0.22;
          const ux = dist < 1 ? 1 : dx / dist;
          const uy = dist < 1 ? 0 : dy / dist;
          // 共线时只沿连线推，会和弹簧一起卡在同一半径上。靠得越近，侧向拨开越多。
          const peel = dist < minDist * 0.8 ? 0.65 : 0;
          const side = (i + j) % 2 === 0 ? 1 : -1;
          const tx = -uy * side * peel;
          const ty = ux * side * peel;
          addDelta(delta, aId, (-ux + tx) * push, (-uy + ty) * push);
          addDelta(delta, bId, (ux - tx) * push, (uy - ty) * push);
        }
      }
      for (const id of movable) {
        const d = delta.get(id)!;
        const mag = Math.hypot(d.x, d.y);
        const scale = mag > STEP_LIMIT ? STEP_LIMIT / mag : 1;
        const current = positions.get(id)!;
        positions.set(id, { x: current.x + d.x * scale, y: current.y + d.y * scale });
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
