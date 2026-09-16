import { Mark } from '@tiptap/core';

export const AnnotationMark = Mark.create({
  name: 'annotationMark',
  // typing at the mark edge must not swallow new text into the annotation
  inclusive: false,

  addAttributes() {
    return {
      annotationId: {
        default: '',
        parseHTML: (element) => element.getAttribute('data-annotation-id') ?? '',
        renderHTML: (attributes) => ({
          'data-annotation-id': String(attributes.annotationId ?? ''),
        }),
      },
    };
  },

  parseHTML() {
    return [{ tag: 'span[data-annotation-id]' }];
  },

  renderHTML({ mark }) {
    return ['span', { 'data-annotation-id': String(mark.attrs['annotationId'] ?? '') }, 0];
  },
});
