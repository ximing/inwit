import { mergeAttributes, Node } from '@tiptap/core';

export const Video = Node.create({
  name: 'video',
  group: 'block',
  atom: true,
  selectable: true,
  draggable: true,

  addAttributes() {
    return {
      src: { default: null },
      poster: { default: null },
      mime: {
        default: null,
        parseHTML: (element) => element.getAttribute('type') || element.getAttribute('data-mime'),
        renderHTML: (attributes) => (attributes.mime ? { type: attributes.mime } : {}),
      },
    };
  },

  parseHTML() {
    return [
      { tag: 'video[src]' },
      {
        // Videos that only carry a <source src type> child (common in captured articles).
        tag: 'video',
        getAttrs: (element) => {
          if (element.getAttribute('src')) return {};
          const source = element.querySelector('source[src]');
          const src = source?.getAttribute('src');
          if (!src) return false;
          const type = source?.getAttribute('type');
          return type ? { src, mime: type } : { src };
        },
      },
    ];
  },

  renderHTML({ HTMLAttributes }) {
    return ['video', mergeAttributes({ controls: '', playsinline: '' }, HTMLAttributes)];
  },
});
