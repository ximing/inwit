import {
  blocksFromPmJSON,
  findEntityAnchors,
  locateQuote,
  type AnchorKind,
  type PmJson,
} from '@inwit/doc-schema';
import type { PmDocJson } from '@inwit/dto';
import { IMAGE_EXCERPT_QUOTE } from '@inwit/dto';
import type { Editor } from '@tiptap/core';
import { Fragment, Slice, type Node as PmNode } from '@tiptap/pm/model';
import { isExcerptQuote } from './anchors';
import { asPmJson, asSchemaJson } from './pm-doc';

export type TextSelectionAnchor = {
  text: string;
  blockIndex: number;
  from: number;
  to: number;
};

export type CardAnchorInput = {
  id: string;
  anchorText?: string | null;
  anchorBlockIndex?: number | null;
  hasImage?: boolean;
};

export type AnnotationAnchorInput = {
  id: string;
  kind?: string;
  quote: string;
  anchorBlockIndex?: number | null;
  imageKey?: string | null;
};

export type MissingAnchor = {
  kind: AnchorKind;
  id: string;
  blockIndex: number;
  quote: string;
};

export type DocEditorHost = {
  getJSON: () => PmDocJson;
  selectionAnchor: () => TextSelectionAnchor | null;
  applyEntityMark: (kind: AnchorKind, id: string, from: number, to: number) => boolean;
  ensureEntityMarks: (
    cards: readonly CardAnchorInput[],
    notes: readonly AnnotationAnchorInput[],
  ) => boolean;
};

const ENTITY_MARKS = new Set(['annotationMark', 'cardAnchor']);

export function blockIndexAt(doc: PmNode, pos: number): number {
  const clamped = Math.max(0, Math.min(pos, doc.content.size));
  return doc.resolve(clamped).index(0) + 1;
}

export function selectionAnchorFromEditor(editor: Editor): TextSelectionAnchor | null {
  const { from, to, empty } = editor.state.selection;
  if (!empty && from !== to) {
    const text = editor.state.doc.textBetween(from, to, ' ').trim();
    if (text) {
      return {
        text,
        blockIndex: blockIndexAt(editor.state.doc, from),
        from,
        to,
      };
    }
  }
  if (typeof window === 'undefined') return null;
  const sel = window.getSelection();
  if (!sel || sel.isCollapsed || sel.rangeCount === 0) return null;
  const text = sel.toString().trim();
  if (!text) return null;
  try {
    const range = sel.getRangeAt(0);
    const start = editor.view.posAtDOM(range.startContainer, range.startOffset);
    const end = editor.view.posAtDOM(range.endContainer, range.endOffset);
    const fromPos = Math.min(start, end);
    const toPos = Math.max(start, end);
    if (fromPos >= toPos) return null;
    return {
      text,
      blockIndex: blockIndexAt(editor.state.doc, fromPos),
      from: fromPos,
      to: toPos,
    };
  } catch {
    return null;
  }
}

function presentIds(doc: PmJson): Set<string> {
  const ids = new Set<string>();
  try {
    for (const anchor of findEntityAnchors(doc)) {
      for (const id of anchor.ids) ids.add(id);
    }
  } catch {
    // ignore malformed docs
  }
  return ids;
}

export function missingTextEntities(
  doc: unknown,
  cards: readonly CardAnchorInput[],
  notes: readonly AnnotationAnchorInput[],
): MissingAnchor[] {
  const json = asSchemaJson(doc);
  const have = presentIds(json);
  const missing: MissingAnchor[] = [];

  for (const card of cards) {
    if (have.has(card.id)) continue;
    const quote = card.anchorText?.trim() ?? '';
    const blockIndex = card.anchorBlockIndex;
    if (!quote || quote === IMAGE_EXCERPT_QUOTE) continue;
    if (blockIndex == null || !Number.isFinite(blockIndex) || blockIndex < 1) continue;
    missing.push({ kind: 'card', id: card.id, blockIndex, quote });
  }

  for (const note of notes) {
    if (have.has(note.id)) continue;
    if (note.kind && note.kind !== 'text') continue;
    const quote = note.quote.trim();
    const blockIndex = note.anchorBlockIndex;
    if (!quote || quote === IMAGE_EXCERPT_QUOTE) continue;
    if (blockIndex == null || !Number.isFinite(blockIndex) || blockIndex < 1) continue;
    missing.push({ kind: 'annotation', id: note.id, blockIndex, quote });
  }

  return missing;
}

export function isLostTextEntity(
  doc: unknown,
  entity: {
    id: string;
    kind: AnchorKind;
    annotationKind?: string | null;
    quote?: string | null;
    blockIndex?: number | null;
    hasImage?: boolean;
  },
): boolean {
  if (entity.kind === 'annotation' && entity.annotationKind && entity.annotationKind !== 'text') {
    return false;
  }
  if (entity.hasImage) return false;
  const json = asSchemaJson(doc);
  if (presentIds(json).has(entity.id)) return false;
  const quote = entity.quote?.trim() ?? '';
  if (!quote || isExcerptQuote(quote)) return true;
  if (entity.blockIndex == null || entity.blockIndex < 1) return true;
  try {
    return locateQuote(json, entity.blockIndex, quote) === null;
  } catch {
    return true;
  }
}

function cardIdsInRange(doc: PmNode, from: number, to: number): string[] {
  const ids: string[] = [];
  const seen = new Set<string>();
  doc.nodesBetween(from, to, (node) => {
    for (const mark of node.marks) {
      if (mark.type.name !== 'cardAnchor') continue;
      const current = mark.attrs['cardIds'];
      if (!Array.isArray(current)) continue;
      for (const id of current) {
        if (typeof id !== 'string' || seen.has(id)) continue;
        seen.add(id);
        ids.push(id);
      }
    }
  });
  return ids;
}

export function applyEntityMarkOnEditor(
  editor: Editor,
  kind: AnchorKind,
  id: string,
  from: number,
  to: number,
): boolean {
  const { doc, schema } = editor.state;
  if (from >= to || from < 0 || to > doc.content.size) return false;
  if (kind === 'annotation') {
    const type = schema.marks['annotationMark'];
    if (!type) return false;
    editor.view.dispatch(editor.state.tr.addMark(from, to, type.create({ annotationId: id })));
    return true;
  }
  const type = schema.marks['cardAnchor'];
  if (!type) return false;
  const ids = cardIdsInRange(doc, from, to);
  if (!ids.includes(id)) ids.push(id);
  editor.view.dispatch(editor.state.tr.addMark(from, to, type.create({ cardIds: ids })));
  return true;
}

export function ensureEntityMarksOnEditor(
  editor: Editor,
  cards: readonly CardAnchorInput[],
  notes: readonly AnnotationAnchorInput[],
): boolean {
  const json = asSchemaJson(editor.getJSON());
  const missing = missingTextEntities(json, cards, notes);
  if (missing.length === 0) return false;

  const { schema } = editor.state;
  const cardType = schema.marks['cardAnchor'];
  const noteType = schema.marks['annotationMark'];
  let tr = editor.state.tr;
  let changed = false;

  for (const item of missing) {
    const range = locateQuote(json, item.blockIndex, item.quote);
    if (!range) continue;
    if (item.kind === 'card') {
      if (!cardType) continue;
      const ids = cardIdsInRange(tr.doc, range.from, range.to);
      if (!ids.includes(item.id)) ids.push(item.id);
      tr = tr.addMark(range.from, range.to, cardType.create({ cardIds: ids }));
      changed = true;
    } else {
      if (!noteType) continue;
      tr = tr.addMark(range.from, range.to, noteType.create({ annotationId: item.id }));
      changed = true;
    }
  }

  if (!changed) return false;
  editor.view.dispatch(tr);
  return true;
}

function stripEntityMarksFromNode(node: PmNode): PmNode {
  const marks = node.marks.filter((mark) => !ENTITY_MARKS.has(mark.type.name));
  if (node.isLeaf) return node.mark(marks);
  const children: PmNode[] = [];
  node.forEach((child) => {
    children.push(stripEntityMarksFromNode(child));
  });
  return node.copy(Fragment.fromArray(children)).mark(marks);
}

export function stripEntityMarksFromSlice(slice: Slice): Slice {
  const nodes: PmNode[] = [];
  slice.content.forEach((node) => {
    nodes.push(stripEntityMarksFromNode(node));
  });
  return new Slice(Fragment.fromArray(nodes), slice.openStart, slice.openEnd);
}

export function createDocEditorHost(editor: Editor): DocEditorHost {
  return {
    getJSON: () => asPmJson(editor.getJSON()),
    selectionAnchor: () => selectionAnchorFromEditor(editor),
    applyEntityMark: (kind, id, from, to) => applyEntityMarkOnEditor(editor, kind, id, from, to),
    ensureEntityMarks: (cards, notes) => ensureEntityMarksOnEditor(editor, cards, notes),
  };
}

export function blockIndexForQuoteOnPage(
  doc: unknown,
  pageIndex0: number,
  quote: string,
): number | null {
  try {
    const blocks = blocksFromPmJSON(asSchemaJson(doc));
    const page = pageIndex0 + 1;
    const onPage = blocks.filter((block) => block.pageIndex === page && block.text.length > 0);
    const clipped = quote.trim();
    if (clipped) {
      const hit = onPage.find((block) => block.text.includes(clipped));
      if (hit) return hit.index;
    }
    return onPage[0]?.index ?? null;
  } catch {
    return null;
  }
}
