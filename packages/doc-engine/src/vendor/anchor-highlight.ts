import { Decoration, Extension } from '@tiptap/core';
import type { Node as PmNode } from '@tiptap/pm/model';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import {
  collectHitIds,
  type EntityMeta,
} from './anchors';

export type AnchorHighlightOptions = {
  getEntities: () => EntityMeta[];
  getActiveCardId: () => string | null;
  getActiveAnnotationId: () => string | null;
  onAnchorClick: (cardIds: string[]) => void;
  onAnnotationClick: (ids: string[]) => void;
};

type MarkSpan = {
  kind: 'card' | 'annotation';
  id: string;
  from: number;
  to: number;
};

type Edge = {
  pos: number;
  delta: number;
  kind: 'card' | 'annotation';
  id: string;
};

function collectKnownMarkSpans(doc: PmNode, known: Set<string>): MarkSpan[] {
  const spans: MarkSpan[] = [];
  doc.descendants((node, pos) => {
    if (!node.isText) return;
    const from = pos;
    const to = pos + (node.text?.length ?? 0);
    if (from >= to) return;
    for (const mark of node.marks) {
      if (mark.type.name === 'cardAnchor') {
        const ids = Array.isArray(mark.attrs['cardIds']) ? mark.attrs['cardIds'] : [];
        for (const id of ids) {
          if (typeof id === 'string' && known.has(id)) {
            spans.push({ kind: 'card', id, from, to });
          }
        }
      } else if (mark.type.name === 'annotationMark') {
        const id = mark.attrs['annotationId'];
        if (typeof id === 'string' && known.has(id)) {
          spans.push({ kind: 'annotation', id, from, to });
        }
      }
    }
  });
  return spans;
}

export type HighlightSegment = {
  from: number;
  to: number;
  cardIds: string[];
  annotationIds: string[];
  active: boolean;
};

export function collectHighlightSegments(
  doc: PmNode,
  entities: EntityMeta[],
  activeCardId: string | null,
  activeAnnotationId: string | null,
): HighlightSegment[] {
  const known = new Set(entities.map((item) => item.id));
  const spans = collectKnownMarkSpans(doc, known);
  if (spans.length === 0) return [];

  const edges: Edge[] = [];
  for (const span of spans) {
    edges.push({ pos: span.from, delta: 1, kind: span.kind, id: span.id });
    edges.push({ pos: span.to, delta: -1, kind: span.kind, id: span.id });
  }
  edges.sort((a, b) => a.pos - b.pos || a.delta - b.delta);

  const activeCards = new Map<string, number>();
  const activeNotes = new Map<string, number>();
  const segments: HighlightSegment[] = [];
  let cursor = -1;
  let i = 0;

  const emit = (from: number, to: number) => {
    if (from >= to) return;
    const cardIds = [...activeCards.keys()];
    const annotationIds = [...activeNotes.keys()];
    if (cardIds.length === 0 && annotationIds.length === 0) return;
    const active =
      Boolean(activeCardId && activeCards.has(activeCardId)) ||
      Boolean(activeAnnotationId && activeNotes.has(activeAnnotationId));
    segments.push({ from, to, cardIds, annotationIds, active });
  };

  while (i < edges.length) {
    const pos = edges[i]!.pos;
    if (cursor >= 0) emit(cursor, pos);
    while (i < edges.length && edges[i]!.pos === pos) {
      const edge = edges[i]!;
      const map = edge.kind === 'card' ? activeCards : activeNotes;
      const next = (map.get(edge.id) ?? 0) + edge.delta;
      if (next <= 0) map.delete(edge.id);
      else map.set(edge.id, next);
      i += 1;
    }
    cursor = pos;
  }

  return segments;
}

export function buildAnchorDecorations(
  doc: PmNode,
  entities: EntityMeta[],
  activeCardId: string | null,
  activeAnnotationId: string | null,
): Decoration[] {
  const noteById = new Map(
    entities.filter((item) => item.kind === 'annotation' && item.note).map((item) => [item.id, item.note!]),
  );
  const decorations: Decoration[] = [];
  for (const segment of collectHighlightSegments(doc, entities, activeCardId, activeAnnotationId)) {
    const classes: string[] = [];
    if (segment.cardIds.length > 0) classes.push('anchor');
    if (segment.annotationIds.length > 0) classes.push('anchor-note');
    if (segment.active) classes.push('is-on', 'is-active');
    const attrs: Record<string, string> = { class: classes.join(' ') };
    if (segment.cardIds.length > 0) {
      attrs['data-card-ids'] = JSON.stringify(segment.cardIds);
      attrs['data-card-id'] = segment.cardIds[0] ?? '';
    }
    if (segment.annotationIds.length > 0) {
      attrs['data-annotation-ids'] = JSON.stringify(segment.annotationIds);
      attrs['data-annotation-id'] = segment.annotationIds[0] ?? '';
      const note = noteById.get(segment.annotationIds[0] ?? '');
      if (note) {
        attrs['data-note'] = note;
        attrs['aria-label'] = `批注：${note}`;
      }
    }
    decorations.push(
      Decoration.Inline(segment.from, segment.to, attrs, { inclusiveStart: false, inclusiveEnd: false }),
    );
  }
  return decorations;
}

const pluginKey = new PluginKey('anchorHighlightClick');

export const AnchorHighlight = Extension.create<AnchorHighlightOptions>({
  name: 'anchorHighlight',

  addOptions() {
    return {
      getEntities: () => [],
      getActiveCardId: () => null,
      getActiveAnnotationId: () => null,
      onAnchorClick: () => undefined,
      onAnnotationClick: () => undefined,
    };
  },

  addDecorations() {
    return {
      update: 'document',
      create: ({ state }) => {
        try {
          return buildAnchorDecorations(
            state.doc,
            this.options.getEntities(),
            this.options.getActiveCardId(),
            this.options.getActiveAnnotationId(),
          );
        } catch {
          return [];
        }
      },
    };
  },

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: pluginKey,
        state: {
          init: () => ({
            activeCardId: this.options.getActiveCardId(),
            activeAnnotationId: this.options.getActiveAnnotationId(),
          }),
          apply: () => ({
            activeCardId: this.options.getActiveCardId(),
            activeAnnotationId: this.options.getActiveAnnotationId(),
          }),
        },
        props: {
          handleDOMEvents: {
            click: (view, event) => {
              if (this.editor.isEditable) return false;
              const target = event.target;
              if (!(target instanceof Element) || !view.dom.contains(target)) return false;
              const { cardIds, annotationIds } = collectHitIds(target, view.dom);
              let handled = false;
              if (annotationIds.length > 0) {
                this.options.onAnnotationClick(annotationIds);
                handled = true;
              }
              if (cardIds.length > 0) {
                this.options.onAnchorClick(cardIds);
                handled = true;
              }
              return handled;
            },
          },
        },
      }),
    ];
  },
});
