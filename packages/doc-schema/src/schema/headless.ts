import { getSchema, type AnyExtension } from '@tiptap/core';
import Image from '@tiptap/extension-image';
import Subscript from '@tiptap/extension-subscript';
import Superscript from '@tiptap/extension-superscript';
import { Table, TableCell, TableHeader, TableRow } from '@tiptap/extension-table';
import TaskItem from '@tiptap/extension-task-item';
import TaskList from '@tiptap/extension-task-list';
import StarterKit from '@tiptap/starter-kit';
import type { Schema } from 'prosemirror-model';
import { AnnotationMark } from './annotation-mark.js';
import { CardAnchorMark } from './card-anchor-mark.js';
import { PageBreak } from './page-break.js';
import { Video } from './video.js';
import { VitalEntity } from './vital-entity.js';

function headlessExtensions(): AnyExtension[] {
  return [
    StarterKit.configure({
      heading: { levels: [1, 2, 3, 4, 5, 6] },
      link: {
        openOnClick: false,
        autolink: true,
      },
    }),
    Table.configure({ resizable: false }),
    TableRow,
    TableHeader,
    TableCell,
    TaskList,
    TaskItem.configure({ nested: true }),
    // inline to match apps/web createDocExtensions; default Image is block.
    Image.configure({ inline: true, allowBase64: false }),
    Subscript,
    Superscript,
    PageBreak,
    AnnotationMark,
    CardAnchorMark,
    Video,
    VitalEntity,
  ];
}

let cached: Schema | undefined;

export function getHeadlessSchema(): Schema {
  cached ??= getSchema(headlessExtensions());
  return cached;
}
