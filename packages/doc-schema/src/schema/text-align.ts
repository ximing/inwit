import type { AnyExtension } from '@tiptap/core';
import TextAlign from '@tiptap/extension-text-align';

export const DOC_TEXT_ALIGN_TYPES = ['heading', 'paragraph', 'blockquote', 'video'] as const;

export function createTextAlignExtension(): AnyExtension {
  return TextAlign.configure({
    types: [...DOC_TEXT_ALIGN_TYPES],
    alignments: ['left', 'center', 'right'],
  });
}
