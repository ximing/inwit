import type { Mark, Node } from 'prosemirror-model';
import { EditorState } from 'prosemirror-state';
import { asStringArray, loadPmDoc } from './pm.js';
import { getHeadlessSchema } from './schema/headless.js';
import type { AnchorKind, EntityAnchor, PmJson, PmMarkJson, TextRange } from './types.js';

const ENTITY_MARKS = new Set(['annotationMark', 'cardAnchor']);

function sameIds(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((id, i) => id === b[i]);
}

function cardIdsOf(mark: Mark): string[] {
  return asStringArray(mark.attrs['cardIds']);
}

function annotationIdsOf(mark: Mark): string[] {
  const id = mark.attrs['annotationId'];
  return typeof id === 'string' ? [id] : [];
}

function collectOverlappingCardIds(doc: Node, range: TextRange): string[] {
  const ids: string[] = [];
  const seen = new Set<string>();
  doc.nodesBetween(range.from, range.to, (node) => {
    for (const mark of node.marks) {
      if (mark.type.name !== 'cardAnchor') continue;
      for (const id of cardIdsOf(mark)) {
        if (seen.has(id)) continue;
        seen.add(id);
        ids.push(id);
      }
    }
  });
  return ids;
}

function requireMarkType(kind: AnchorKind) {
  const schema = getHeadlessSchema();
  const type = kind === 'card' ? schema.marks['cardAnchor'] : schema.marks['annotationMark'];
  if (!type) {
    throw new Error(kind === 'card' ? 'schema is missing cardAnchor' : 'schema is missing annotationMark');
  }
  return type;
}

function withCardId(existing: string[], id: string): string[] {
  return existing.includes(id) ? existing : [...existing, id];
}

export function applyEntityAnchor(
  doc: PmJson,
  kind: AnchorKind,
  id: string,
  range: TextRange,
): PmJson {
  const pm = loadPmDoc(doc);
  const markType = requireMarkType(kind);
  const mark =
    kind === 'card'
      ? markType.create({ cardIds: withCardId(collectOverlappingCardIds(pm, range), id) })
      : markType.create({ annotationId: id });
  const state = EditorState.create({ doc: pm });
  const tr = state.tr.addMark(range.from, range.to, mark);
  return tr.doc.toJSON() as PmJson;
}

function flush(current: EntityAnchor | null, out: EntityAnchor[]): EntityAnchor | null {
  if (current) out.push(current);
  return null;
}

export function findEntityAnchors(doc: PmJson): EntityAnchor[] {
  const pm = loadPmDoc(doc);
  const out: EntityAnchor[] = [];
  let card: EntityAnchor | null = null;
  let annotation: EntityAnchor | null = null;

  pm.descendants((node, pos) => {
    if (node.isText) {
      const cardMark = node.marks.find((mark) => mark.type.name === 'cardAnchor');
      const annotationMark = node.marks.find((mark) => mark.type.name === 'annotationMark');
      const to = pos + node.nodeSize;

      if (cardMark) {
        const ids = cardIdsOf(cardMark);
        if (card && card.to === pos && sameIds(card.ids, ids)) card.to = to;
        else {
          card = flush(card, out);
          card = { kind: 'card', ids, from: pos, to };
        }
      } else {
        card = flush(card, out);
      }

      if (annotationMark) {
        const ids = annotationIdsOf(annotationMark);
        if (annotation && annotation.to === pos && sameIds(annotation.ids, ids)) annotation.to = to;
        else {
          annotation = flush(annotation, out);
          annotation = { kind: 'annotation', ids, from: pos, to };
        }
      } else {
        annotation = flush(annotation, out);
      }
      return;
    }
    if (node.isLeaf) {
      card = flush(card, out);
      annotation = flush(annotation, out);
    }
  });
  flush(card, out);
  flush(annotation, out);
  out.sort((a, b) => a.from - b.from || a.to - b.to || a.kind.localeCompare(b.kind));
  return out;
}

function stripMarks(marks: PmMarkJson[] | undefined): PmMarkJson[] | undefined {
  if (!marks) return undefined;
  const kept = marks.filter((mark) => !ENTITY_MARKS.has(mark.type));
  return kept.length > 0 ? kept : undefined;
}

function stripNode(node: PmJson): PmJson {
  const next: PmJson = { type: node.type };
  if (node.attrs !== undefined) next.attrs = node.attrs;
  if (node.text !== undefined) next.text = node.text;
  const marks = stripMarks(node.marks);
  if (marks) next.marks = marks;
  if (node.content !== undefined) next.content = node.content.map(stripNode);
  return next;
}

export function stripEntityAnchors(doc: PmJson): PmJson {
  return stripNode(doc);
}
