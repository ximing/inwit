import { Mark } from '@tiptap/core';

function parseCardIds(raw: string | null): string[] {
  if (raw == null || raw === '') return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed) || parsed.some((id) => typeof id !== 'string')) return [];
    return parsed;
  } catch {
    return [];
  }
}

function cardIdsFromAttr(value: unknown): string[] {
  if (!Array.isArray(value) || value.some((id) => typeof id !== 'string')) return [];
  return value;
}

export const CardAnchorMark = Mark.create({
  name: 'cardAnchor',
  // typing at the mark edge must not swallow new text into the card anchor
  inclusive: false,

  addAttributes() {
    return {
      cardIds: {
        default: [],
        parseHTML: (element) => parseCardIds(element.getAttribute('data-card-ids')),
        renderHTML: (attributes) => ({
          'data-card-ids': JSON.stringify(cardIdsFromAttr(attributes.cardIds)),
        }),
      },
    };
  },

  parseHTML() {
    return [{ tag: 'span[data-card-ids]' }];
  },

  renderHTML({ mark }) {
    return ['span', { 'data-card-ids': JSON.stringify(cardIdsFromAttr(mark.attrs['cardIds'])) }, 0];
  },
});
