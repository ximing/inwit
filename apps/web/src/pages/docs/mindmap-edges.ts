import type { MindDrop } from './mindmap-hit.js';
import type { MindBox } from './mindmap-layout.js';

export type PlaceVerdict =
  | { ok: true; unchanged: boolean }
  | { ok: false; reason: 'missing' | 'self' | 'cycle' | 'depth' }
  | null;

/** 脉络虚线上的另一张卡。只要 id 和所属文档。 */
export type GhostLinkEnd = {
  card: { id: string; documentId: string | null };
};

export function hintFor(
  drop: MindDrop,
  plan: PlaceVerdict,
  count = 1,
): { text: string | null; accept: boolean } {
  if (!plan || !plan.ok) {
    return {
      text: plan && !plan.ok && plan.reason === 'depth' ? '层级太深了' : '不能放到这里',
      accept: false,
    };
  }
  if (plan.unchanged) return { text: null, accept: false };
  const prefix = count > 1 ? `${count} 个节点：` : '';
  if (drop.kind === 'root') return { text: `${prefix}独立成树`, accept: true };
  if (drop.kind === 'child') return { text: `${prefix}成为子节点`, accept: true };
  if (drop.kind === 'before') return { text: `${prefix}排在前面`, accept: true };
  return { text: `${prefix}排在后面`, accept: true };
}

/** 树边：源盒右边中点到目标盒左边中点。 */
export function edgePath(from: MindBox, to: MindBox): string {
  const x1 = from.x + from.width;
  const y1 = from.y + from.height / 2;
  const x2 = to.x;
  const y2 = to.y + to.height / 2;
  const bend = Math.max(24, (x2 - x1) / 2);
  return `M ${x1} ${y1} C ${x1 + bend} ${y1}, ${x2 - bend} ${y2}, ${x2} ${y2}`;
}

/** 脉络虚线边：中心对中心，方向任意，画在节点底下。 */
export function ghostPath(from: MindBox, to: MindBox): string {
  const x1 = from.x + from.width / 2;
  const y1 = from.y + from.height / 2;
  const x2 = to.x + to.width / 2;
  const y2 = to.y + to.height / 2;
  const bend = Math.max(32, Math.min(140, Math.abs(x2 - x1) / 2)) * (x2 >= x1 ? 1 : -1);
  return `M ${x1} ${y1} C ${x1 + bend} ${y1}, ${x2 - bend} ${y2}, ${x2} ${y2}`;
}

/**
 * 本文内、且在当前布局里的关联卡片。
 * outgoing 在前，incoming 在后；自己、重复、别的文档和不在画布上的都跳过。
 */
export function ghostTargetIds(
  links: { outgoing: readonly GhostLinkEnd[]; incoming: readonly GhostLinkEnd[] } | null,
  selfId: string | null,
  documentId: string | null,
  placed: { has(id: string): boolean },
): string[] {
  if (!selfId || !links) return [];
  const seen = new Set<string>();
  const targets: string[] = [];
  for (const item of [...links.outgoing, ...links.incoming]) {
    const id = item.card.id;
    if (id === selfId || seen.has(id) || !placed.has(id)) continue;
    if (item.card.documentId == null || item.card.documentId !== documentId) continue;
    seen.add(id);
    targets.push(id);
  }
  return targets;
}
