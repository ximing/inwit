import {
  CARD_OUTLINE_MAX_DEPTH,
  outlineChildSlots,
  outlineSlot,
  type AnnotationGeometry,
  type OutlineNode,
} from '@inwit/dto';
import type { MindDrop } from './mindmap-hit';
import type { MindPlace } from './mindmap-edit';

/** 正文选区拖到脑图时的 dataTransfer 类型。 */
export const QUOTE_DRAG_MIME = 'application/x-inwit-quote';

/** 落成批注节点需要的锚点信息，与选区浮层批注一致。 */
export type QuoteDragExtra =
  | { kind: 'pdf'; pageIndex: number; geometry: AnnotationGeometry; imageKey?: string }
  | { anchorBlockIndex?: number; from?: number; to?: number };

export type QuoteDragPayload = {
  documentId: string;
  quote: string;
  extra?: QuoteDragExtra;
};

export function encodeQuoteDrag(payload: QuoteDragPayload): string {
  return JSON.stringify(payload);
}

/** 解析拖拽负载；形状不对或引文为空时返回 null。 */
export function parseQuoteDrag(raw: string | null | undefined): QuoteDragPayload | null {
  if (!raw) return null;
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof value !== 'object' || value === null) return null;
  const record = value as Record<string, unknown>;
  if (typeof record.documentId !== 'string' || record.documentId.length === 0) return null;
  if (typeof record.quote !== 'string' || record.quote.trim().length === 0) return null;
  const extra = record.extra;
  if (extra !== undefined) {
    if (typeof extra !== 'object' || extra === null) return null;
    const extraRecord = extra as Record<string, unknown>;
    if (extraRecord.kind !== undefined && extraRecord.kind !== 'pdf') return null;
  }
  return {
    documentId: record.documentId,
    quote: record.quote,
    ...(extra !== undefined ? { extra: extra as QuoteDragExtra } : {}),
  };
}

/** 节点自身所在的层级（根为第 1 级），父链成环时视为超深。 */
function depthOf(nodes: readonly OutlineNode[], id: string): number {
  const parentOf = new Map(nodes.map((node) => [node.id, node.parentId]));
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

/**
 * 正文拖来的引文落成新批注节点时的落点。新节点还不在树里（先以根身份进来），
 * 所以不用拿掉自己；拖到空白、落点不合法或层级太深都返回 null —— 保持独立成树。
 */
export function quoteDropPlace(nodes: readonly OutlineNode[], drop: MindDrop): MindPlace | null {
  if (drop.kind === 'root') return null;
  if (drop.kind === 'child') {
    if (!nodes.some((node) => node.id === drop.parentId)) return null;
    if (depthOf(nodes, drop.parentId) + 1 > CARD_OUTLINE_MAX_DEPTH) return null;
    return { parentId: drop.parentId, index: outlineChildSlots(nodes, drop.parentId).length };
  }
  const slot = outlineSlot(nodes, drop.siblingId);
  if (!slot) return null;
  if (slot.parentId !== null && depthOf(nodes, slot.parentId) + 1 > CARD_OUTLINE_MAX_DEPTH) {
    return null;
  }
  return { parentId: slot.parentId, index: drop.kind === 'before' ? slot.index : slot.index + 1 };
}
