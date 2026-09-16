import { Node } from '@tiptap/core';

function pageIndexFromAttr(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value) && value >= 1) {
    return Math.floor(value);
  }
  if (typeof value === 'string') {
    const n = Number.parseInt(value, 10);
    if (Number.isFinite(n) && n >= 1) return n;
  }
  return 1;
}

export const PageBreak = Node.create({
  name: 'pageBreak',
  group: 'block',
  atom: true,

  addAttributes() {
    return {
      pageIndex: {
        default: 1,
        parseHTML: (element) => pageIndexFromAttr(element.getAttribute('data-page-index')),
        renderHTML: (attributes) => ({
          'data-page-index': String(pageIndexFromAttr(attributes.pageIndex)),
        }),
      },
    };
  },

  parseHTML() {
    return [{ tag: 'div[data-page-break]' }];
  },

  renderHTML({ node }) {
    return [
      'div',
      {
        'data-page-break': '',
        'data-page-index': String(pageIndexFromAttr(node.attrs['pageIndex'])),
      },
    ];
  },
});
