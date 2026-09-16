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
    return [{ tag: 'video[src]' }];
  },

  renderHTML({ HTMLAttributes }) {
    return ['video', mergeAttributes({ controls: '', playsinline: '' }, HTMLAttributes)];
  },
});
