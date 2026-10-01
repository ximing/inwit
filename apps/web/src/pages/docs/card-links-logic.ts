import type { CardLinkType, CardLinkWithCard, CardLinksResponse } from '@inwit/dto';

export const LINK_ORDER: CardLinkType[] = [
  'confusable',
  'prerequisite',
  'related',
  'same_concept',
];

export const LINK_META: Record<CardLinkType, { label: string; mark: string; rel: string }> = {
  confusable: { label: '易混淆', mark: '⚡', rel: 'conf' },
  prerequisite: { label: '前置', mark: '↳', rel: 'pre' },
  related: { label: '相关', mark: '∿', rel: 'rel' },
  same_concept: { label: '同概念', mark: '＝', rel: 'same' },
};

/** Outgoing and incoming links, one row per type + card. */
export function groupedCardLinks(
  links: CardLinksResponse,
): { type: CardLinkType; items: CardLinkWithCard[] }[] {
  const seen = new Set<string>();
  const byType: Record<CardLinkType, CardLinkWithCard[]> = {
    confusable: [],
    prerequisite: [],
    related: [],
    same_concept: [],
  };
  for (const item of [...links.outgoing, ...links.incoming]) {
    const key = `${item.type}:${item.card.id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    byType[item.type].push(item);
  }
  return LINK_ORDER.filter((type) => byType[type].length > 0).map((type) => ({
    type,
    items: byType[type],
  }));
}
