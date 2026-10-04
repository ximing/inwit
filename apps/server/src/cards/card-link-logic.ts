import type { CardLinkType } from '@inwit/dto';

export type CardLinkCheck =
  | { ok: true }
  | { ok: false; code: 'CARD_LINK_SELF' | 'CARD_LINK_EXISTS' };

/**
 * 建关系边前的纯校验：不允许自环，不允许与同向同类型的已有边重复
 * （表上有 (from, to, type) 唯一索引，先查重给 409，而不是撞上 500）。
 */
export function checkNewCardLink(
  fromCardId: string,
  toCardId: string,
  type: CardLinkType,
  existing: readonly { fromCardId: string; toCardId: string; type: CardLinkType }[],
): CardLinkCheck {
  if (fromCardId === toCardId) return { ok: false, code: 'CARD_LINK_SELF' };
  const dup = existing.some(
    (link) =>
      link.fromCardId === fromCardId && link.toCardId === toCardId && link.type === type,
  );
  if (dup) return { ok: false, code: 'CARD_LINK_EXISTS' };
  return { ok: true };
}
