import type { MindBox } from './mindmap-layout';

/** 拖动时指针落在哪个落点。before/after 是插到该节点同一层的前面或后面。 */
export type MindDrop =
  | { kind: 'child'; parentId: string }
  | { kind: 'before'; siblingId: string }
  | { kind: 'after'; siblingId: string }
  | { kind: 'root' };

const EDGE = 0.28;
const GAP = 18;

/** 屏幕像素。没拖开这么远，松手仍是点击。 */
export const MIND_DRAG_ARM_PX = 20;

/**
 * 拖到空白处要再远一截，才把节点拆出当前树。
 * 被拖的节点不算落点，近处一松手就会被当成空白。
 */
export const MIND_DRAG_ROOT_PX = 80;

/** 拖动还没到位时不改树。空白处的「独立成树」比挂到别的节点更晚生效。 */
export function mindDragCommit(travelPx: number, drop: MindDrop): 'click' | 'cancel' | 'commit' {
  if (!Number.isFinite(travelPx) || travelPx < MIND_DRAG_ARM_PX) return 'click';
  if (drop.kind === 'root' && travelPx < MIND_DRAG_ROOT_PX) return 'cancel';
  return 'commit';
}

/**
 * 节点上沿、下沿是插入线，中间是收成子节点。
 * 节点之间的缝也算插入线，避免掉进缝里被当成拖到空白。
 * except 是被拖的节点（单个 id 或整组 id），它们不是合法落点。
 */
export function hitMindDrop(
  boxes: readonly MindBox[],
  x: number,
  y: number,
  except: string | ReadonlySet<string>,
): MindDrop {
  const excluded = typeof except === 'string' ? new Set([except]) : except;
  let inside: MindBox | null = null;
  for (const box of boxes) {
    if (excluded.has(box.id)) continue;
    if (x >= box.x && x <= box.x + box.width && y >= box.y && y <= box.y + box.height) inside = box;
  }
  if (inside) {
    const span = inside.height || 1;
    const t = (y - inside.y) / span;
    if (t < EDGE) return { kind: 'before', siblingId: inside.id };
    if (t > 1 - EDGE) return { kind: 'after', siblingId: inside.id };
    return { kind: 'child', parentId: inside.id };
  }

  let best: { kind: 'before' | 'after'; id: string; dist: number } | null = null;
  for (const box of boxes) {
    if (excluded.has(box.id)) continue;
    if (x < box.x || x > box.x + box.width) continue;
    if (y < box.y && box.y - y <= GAP) {
      const dist = box.y - y;
      if (!best || dist < best.dist) best = { kind: 'before', id: box.id, dist };
    } else if (y > box.y + box.height && y - (box.y + box.height) <= GAP) {
      const dist = y - (box.y + box.height);
      if (!best || dist < best.dist) best = { kind: 'after', id: box.id, dist };
    }
  }
  if (best) return { kind: best.kind, siblingId: best.id };
  return { kind: 'root' };
}

/** 手绘关系边的落点：指针落在哪张卡片节点里（非卡片不算），不含起点自己。 */
export function hitCardBox(
  boxes: readonly MindBox[],
  x: number,
  y: number,
  fromId: string,
  cardIds: ReadonlySet<string>,
): string | null {
  for (const box of boxes) {
    if (box.id === fromId || !cardIds.has(box.id)) continue;
    if (x >= box.x && x <= box.x + box.width && y >= box.y && y <= box.y + box.height) {
      return box.id;
    }
  }
  return null;
}
