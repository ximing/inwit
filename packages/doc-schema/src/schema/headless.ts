import { getSchema, type AnyExtension } from '@tiptap/core';
import Image from '@tiptap/extension-image';
import Subscript from '@tiptap/extension-subscript';
import Superscript from '@tiptap/extension-superscript';
import { Table, TableRow } from '@tiptap/extension-table';
import TaskItem from '@tiptap/extension-task-item';
import TaskList from '@tiptap/extension-task-list';
import StarterKit from '@tiptap/starter-kit';
import type { Schema } from 'prosemirror-model';
import { AnnotationMark } from './annotation-mark.js';
import { CardAnchorMark } from './card-anchor-mark.js';
import { FoldableCodeBlock } from './code-block.js';
import { MermaidBlock } from './mermaid-block.js';
import { PageBreak } from './page-break.js';
import { createDocMathExtensions } from './math.js';
import { createTextAlignExtension } from './text-align.js';
import { DocTableCell, DocTableHeader } from './table-cell.js';
import { createDocTextStyleExtensions } from './text-style.js';
import { Video } from './video.js';
import { VitalEntity } from './vital-entity.js';

/** Extensions shared by the editor schema and server-side HTML→PM conversion. */
export function getHeadlessExtensions(): AnyExtension[] {
  return [
    StarterKit.configure({
      heading: { levels: [1, 2, 3, 4, 5, 6] },
      codeBlock: false,
      link: {
        openOnClick: false,
        autolink: true,
      },
    }),
    FoldableCodeBlock,
    Table.configure({ resizable: false }),
    TableRow,
    DocTableHeader,
    DocTableCell,
    TaskList,
    TaskItem.configure({ nested: true }),
    // inline to match apps/web createDocExtensions; default Image is block.
    Image.configure({ inline: true, allowBase64: false }),
    Subscript,
    Superscript,
    PageBreak,
    MermaidBlock,
    AnnotationMark,
    CardAnchorMark,
    Video,
    VitalEntity,
    createTextAlignExtension(),
    ...createDocTextStyleExtensions(),
    ...createDocMathExtensions(),
  ];
}

let cached: Schema | undefined;

export function getHeadlessSchema(): Schema {
  cached ??= getSchema(getHeadlessExtensions());
  return cached;
}
