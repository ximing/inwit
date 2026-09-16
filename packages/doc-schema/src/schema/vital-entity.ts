import { mergeAttributes, Node } from '@tiptap/core';

function attrString(attrs: Record<string, unknown>, key: string): string {
  const value = attrs[key];
  return typeof value === 'string' ? value : '';
}

export const VitalEntity = Node.create({
  name: 'vitalEntity',
  group: 'inline',
  inline: true,
  atom: true,
  selectable: true,
  draggable: true,

  addAttributes() {
    return {
      kind: {
        default: 'task',
        parseHTML: (element) => {
          const value = element.getAttribute('data-kind');
          return value === 'task' || value === 'inbox' ? value : 'task';
        },
        renderHTML: (attributes) => ({ 'data-kind': attributes.kind }),
      },
      id: {
        default: '',
        parseHTML: (element) => element.getAttribute('data-id') ?? '',
        renderHTML: (attributes) => ({ 'data-id': attributes.id }),
      },
    };
  },

  parseHTML() {
    return [{ tag: 'span.vital-chip' }];
  },

  renderHTML({ node, HTMLAttributes }) {
    const kind = attrString(node.attrs, 'kind');
    const id = attrString(node.attrs, 'id');
    return ['span', mergeAttributes({ class: 'vital-chip' }, HTMLAttributes), `${kind}:${id}`];
  },
});
