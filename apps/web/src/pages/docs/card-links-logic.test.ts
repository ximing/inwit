import type { CardLinkWithCard, CardLinksResponse } from '@inwit/dto';
import { describe, expect, it } from 'vitest';
import { groupedCardLinks } from './card-links-logic';

function link(partial: Pick<CardLinkWithCard, 'id' | 'type' | 'card'> & Partial<CardLinkWithCard>): CardLinkWithCard {
  return {
    userId: 'user',
    fromCardId: 'from',
    toCardId: partial.card.id,
    origin: 'agent',
    reason: null,
    createdAt: '2026-10-01T00:00:00.000Z',
    ...partial,
  };
}

describe('groupedCardLinks', () => {
  it('merges both directions, drops duplicates, and keeps the display order', () => {
    const shared = link({
      id: 'a',
      type: 'related',
      card: { id: 'card-a', documentId: 'doc', concept: '甲', tags: [] },
    });
    const links: CardLinksResponse = {
      outgoing: [
        shared,
        link({
          id: 'b',
          type: 'confusable',
          card: { id: 'card-b', documentId: null, concept: '乙', tags: [] },
        }),
      ],
      incoming: [
        { ...shared, id: 'a-in' },
        link({
          id: 'c',
          type: 'same_concept',
          card: { id: 'card-c', documentId: 'other', concept: '丙', tags: [] },
        }),
      ],
    };
    expect(groupedCardLinks(links).map((group) => [group.type, group.items.map((item) => item.card.id)])).toEqual([
      ['confusable', ['card-b']],
      ['related', ['card-a']],
      ['same_concept', ['card-c']],
    ]);
  });
});
