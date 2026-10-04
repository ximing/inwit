import { outlineChildSlots, outlineSlot, planOutlinePlace, type OutlineNode } from '@inwit/dto';
import type { MindDrop } from './mindmap-hit';

export const MIND_NEW_TEXT = '新节点';

export type MindPlace = { parentId: string | null; index: number };

/** 从节点往上，哪些折叠挡住了它。 */
export function foldsHiding(
  nodes: readonly { id: string; parentId: string | null }[],
  id: string,
  folded: ReadonlySet<string>,
): string[] {
  const parentOf = new Map(nodes.map((node) => [node.id, node.parentId]));
  const hiding: string[] = [];
  let current = parentOf.get(id) ?? null;
  const seen = new Set<string>();
  while (current) {
    if (seen.has(current)) break;
    seen.add(current);
    if (folded.has(current)) hiding.push(current);
    current = parentOf.get(current) ?? null;
  }
  return hiding;
}

/** 折叠节点的全部后代。折叠的节点自己仍可见。 */
export function foldedAway(
  nodes: readonly { id: string; parentId: string | null }[],
  folded: ReadonlySet<string>,
): Set<string> {
  const kids = new Map<string, string[]>();
  for (const node of nodes) {
    if (!node.parentId) continue;
    const list = kids.get(node.parentId) ?? [];
    list.push(node.id);
    kids.set(node.parentId, list);
  }
  const hidden = new Set<string>();
  const walk = (id: string) => {
    for (const child of kids.get(id) ?? []) {
      if (hidden.has(child)) continue;
      hidden.add(child);
      walk(child);
    }
  };
  for (const id of folded) walk(id);
  return hidden;
}

/** 拖放落点换成「拿掉自己之后」的父节点和下标。已经是根时，再拖到空白处不动。 */
export function placeFromDrop(
  nodes: readonly OutlineNode[],
  dragId: string,
  drop: MindDrop,
): MindPlace | null {
  if (drop.kind === 'root') {
    const slot = outlineSlot(nodes, dragId);
    if (!slot) return null;
    if (slot.parentId === null) return { parentId: null, index: slot.index };
    const roots = outlineChildSlots(nodes, null).filter((item) => item.id !== dragId);
    return { parentId: null, index: roots.length };
  }
  if (drop.kind === 'child') {
    if (drop.parentId === dragId) return null;
    const count = outlineChildSlots(nodes, drop.parentId).filter((item) => item.id !== dragId).length;
    return { parentId: drop.parentId, index: count };
  }
  const slot = outlineSlot(nodes, drop.siblingId);
  if (!slot || drop.siblingId === dragId) return null;
  const drag = outlineSlot(nodes, dragId);
  let index = slot.index;
  if (drag && drag.parentId === slot.parentId && drag.index < slot.index) index -= 1;
  if (drop.kind === 'after') index += 1;
  return { parentId: slot.parentId, index };
}

/** 成为上一个兄弟的最后一个子节点。 */
export function indentPlace(
  nodes: readonly OutlineNode[],
  id: string,
): MindPlace | null {
  const slot = outlineSlot(nodes, id);
  if (!slot || slot.index <= 0) return null;
  const prev = outlineChildSlots(nodes, slot.parentId)[slot.index - 1];
  if (!prev) return null;
  return { parentId: prev.id, index: outlineChildSlots(nodes, prev.id).length };
}

/** 升到父节点的下一顺位。 */
export function outdentPlace(nodes: readonly OutlineNode[], id: string): MindPlace | null {
  const slot = outlineSlot(nodes, id);
  if (!slot?.parentId) return null;
  const parent = outlineSlot(nodes, slot.parentId);
  if (!parent) return null;
  return { parentId: parent.parentId, index: parent.index + 1 };
}

/** 与上一个或下一个兄弟交换。 */
export function nudgePlace(
  nodes: readonly OutlineNode[],
  id: string,
  dir: -1 | 1,
): MindPlace | null {
  const slot = outlineSlot(nodes, id);
  if (!slot) return null;
  const next = slot.index + dir;
  const count = outlineChildSlots(nodes, slot.parentId).length;
  if (next < 0 || next >= count) return null;
  return { parentId: slot.parentId, index: next };
}

export function childPlace(nodes: readonly OutlineNode[], parentId: string): MindPlace {
  return { parentId, index: outlineChildSlots(nodes, parentId).length };
}

/** 在这个节点后面插入一个新节点（新节点还不在树里）。 */
export function siblingInsert(nodes: readonly OutlineNode[], id: string): MindPlace | null {
  const slot = outlineSlot(nodes, id);
  if (!slot) return null;
  return { parentId: slot.parentId, index: slot.index + 1 };
}

export type MindNav =
  | { type: 'fold' }
  | { type: 'unfold' }
  | { type: 'select'; id: string }
  | { type: 'none' };

export function navigateMind(
  nodes: readonly OutlineNode[],
  selectedId: string,
  key: 'ArrowLeft' | 'ArrowRight' | 'ArrowUp' | 'ArrowDown',
  folded: ReadonlySet<string>,
): MindNav {
  const slot = outlineSlot(nodes, selectedId);
  if (!slot) return { type: 'none' };
  const children = outlineChildSlots(nodes, selectedId);
  if (key === 'ArrowLeft') {
    if (children.length > 0 && !folded.has(selectedId)) return { type: 'fold' };
    if (slot.parentId) return { type: 'select', id: slot.parentId };
    return { type: 'none' };
  }
  if (key === 'ArrowRight') {
    if (children.length > 0 && folded.has(selectedId)) return { type: 'unfold' };
    const first = children[0];
    if (first) return { type: 'select', id: first.id };
    return { type: 'none' };
  }
  const siblings = outlineChildSlots(nodes, slot.parentId);
  const index = siblings.findIndex((item) => item.id === selectedId);
  const next = key === 'ArrowUp' ? index - 1 : index + 1;
  const target = siblings[next];
  if (!target) return { type: 'none' };
  return { type: 'select', id: target.id };
}

/**
 * 整组拖放的落点换算。ids 是顶层被选节点（mindTopmostSelected 的结果）。
 * index 先把整组从目标兄弟列表里拿掉再数，落定时依次插到 index、index+1…。
 * 拖到空白且整组都已经是根时返回 null（不动）。
 */
export function placeGroupFromDrop(
  nodes: readonly OutlineNode[],
  ids: readonly string[],
  drop: MindDrop,
): MindPlace | null {
  if (ids.length === 0) return null;
  const group = new Set(ids);
  if (drop.kind === 'root') {
    const allRoots = ids.every((id) => (outlineSlot(nodes, id)?.parentId ?? null) === null);
    if (allRoots) return null;
    const roots = outlineChildSlots(nodes, null).filter((slot) => !group.has(slot.id));
    return { parentId: null, index: roots.length };
  }
  if (drop.kind === 'child') {
    if (group.has(drop.parentId)) return null;
    const children = outlineChildSlots(nodes, drop.parentId).filter((slot) => !group.has(slot.id));
    return { parentId: drop.parentId, index: children.length };
  }
  if (group.has(drop.siblingId)) return null;
  const slot = outlineSlot(nodes, drop.siblingId);
  if (!slot) return null;
  const siblings = outlineChildSlots(nodes, slot.parentId).filter((item) => !group.has(item.id));
  const at = siblings.findIndex((item) => item.id === drop.siblingId);
  if (at < 0) return null;
  return { parentId: slot.parentId, index: drop.kind === 'before' ? at : at + 1 };
}

export type MindGroupVerdict =
  | { ok: true; unchanged: boolean }
  | { ok: false; reason: 'missing' | 'self' | 'cycle' | 'depth' };

/** 整组落位预检：每个顶层节点按 index+i 单独判（含层级上限），任一不合法则整组取消。 */
export function planGroupPlace(
  nodes: readonly OutlineNode[],
  ids: readonly string[],
  place: MindPlace,
): MindGroupVerdict {
  let unchanged = true;
  for (let index = 0; index < ids.length; index += 1) {
    const plan = planOutlinePlace(nodes, ids[index] as string, place.parentId, place.index + index);
    if (!plan.ok) return { ok: false, reason: plan.reason };
    if (!plan.unchanged) unchanged = false;
  }
  return { ok: true, unchanged };
}
