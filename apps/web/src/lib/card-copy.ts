import type {
  CardLinkType,
  CardLinksResponse,
  CardLinkWithCard,
  CardQuestionType,
} from '@inwit/dto';

export const QUESTION_TYPE_LABEL: Record<CardQuestionType, string> = {
  cloze: '填空',
  compare: '对比',
  judge: '判断',
};

export const CARD_LINK_TYPE_LABEL: Record<CardLinkType, string> = {
  same_concept: '同概念',
  confusable: '易混淆',
  prerequisite: '前置',
  related: '相关',
};

export const CARD_LINK_TYPE_ORDER: CardLinkType[] = [
  'same_concept',
  'confusable',
  'prerequisite',
  'related',
];

export type RelatedLink = CardLinkWithCard & { direction: 'out' | 'in' };

export type RelatedGroup = {
  type: CardLinkType;
  label: string;
  items: RelatedLink[];
};

export function uniqueRelatedCount(links: CardLinksResponse): number {
  const ids = new Set<string>();
  for (const link of links.outgoing) ids.add(link.card.id);
  for (const link of links.incoming) ids.add(link.card.id);
  return ids.size;
}

export function groupCardLinks(links: CardLinksResponse): RelatedGroup[] {
  const buckets = new Map<CardLinkType, RelatedLink[]>();
  for (const type of CARD_LINK_TYPE_ORDER) buckets.set(type, []);
  const seen = new Set<string>();

  const push = (link: CardLinkWithCard, direction: 'out' | 'in') => {
    const key = `${link.type}:${link.card.id}`;
    if (seen.has(key)) return;
    seen.add(key);
    buckets.get(link.type)?.push({ ...link, direction });
  };

  for (const link of links.outgoing) push(link, 'out');
  for (const link of links.incoming) push(link, 'in');

  return CARD_LINK_TYPE_ORDER.flatMap((type) => {
    const items = buckets.get(type) ?? [];
    if (items.length === 0) return [];
    return [{ type, label: CARD_LINK_TYPE_LABEL[type], items }];
  });
}
