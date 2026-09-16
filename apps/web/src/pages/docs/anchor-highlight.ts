import { Decoration, Extension } from '@tiptap/core';
import type { Node as PmNode } from '@tiptap/pm/model';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import {
  annotationIdsFromAnchor,
  cardIdsFromAnchor,
  findSubstringRanges,
  groupAnchorsByText,
  noteSummary,
  type AnchorSpec,
} from '@/lib/anchors';

export type AnchorHighlightOptions = {
  getAnchors: () => AnchorSpec[];
  getActiveCardId: () => string | null;
  getActiveAnnotationId: () => string | null;
  onAnchorClick: (cardIds: string[]) => void;
  onAnnotationClick: (ids: string[]) => void;
};

function collectTextIndex(doc: PmNode): { haystack: string; indexToPos: number[] } {
  let haystack = '';
  const indexToPos: number[] = [];
  doc.descendants((node, pos) => {
    if (!node.isText) return;
    const value = node.text ?? '';
    for (let i = 0; i < value.length; i += 1) {
      haystack += value[i]!;
      indexToPos.push(pos + i);
    }
  });
  return { haystack, indexToPos };
}

export function buildAnchorDecorations(
  doc: PmNode,
  anchors: AnchorSpec[],
  activeCardId: string | null,
  activeAnnotationId: string | null,
): Decoration[] {
  const grouped = groupAnchorsByText(anchors);
  if (grouped.length === 0) return [];
  const { haystack, indexToPos } = collectTextIndex(doc);
  if (!haystack) return [];

  const decorations: Decoration[] = [];
  for (const { text, ids, kind, note } of grouped) {
    for (const range of findSubstringRanges(haystack, text)) {
      const from = indexToPos[range.start];
      const last = indexToPos[range.end - 1];
      if (from === undefined || last === undefined) continue;
      const to = last + 1;
      if (from >= to || to > doc.content.size) continue;
      const $from = doc.resolve(from);
      const $end = doc.resolve(to - 1);
      if ($from.parent !== $end.parent) continue;
      const on =
        kind === 'annotation'
          ? Boolean(activeAnnotationId && ids.includes(activeAnnotationId))
          : Boolean(activeCardId && ids.includes(activeCardId));
      const isNote = kind === 'annotation';
      const cls = isNote ? (on ? 'anchor-note is-on' : 'anchor-note') : on ? 'anchor is-on' : 'anchor';
      const attrs: Record<string, string> = { class: cls };
      if (isNote) {
        attrs['data-annotation-id'] = ids[0] ?? '';
        attrs['data-annotation-ids'] = ids.join(',');
        if (note) {
          const summary = noteSummary(note);
          attrs['data-note'] = summary;
          attrs['aria-label'] = `批注：${summary}`;
        }
      } else {
        attrs['data-card-id'] = ids[0] ?? '';
        attrs['data-card-ids'] = ids.join(',');
      }
      decorations.push(
        Decoration.Inline(from, to, attrs, { inclusiveStart: false, inclusiveEnd: false }),
      );
    }
  }
  return decorations;
}

export const AnchorHighlight = Extension.create<AnchorHighlightOptions>({
  name: 'anchorHighlight',

  addOptions() {
    return {
      getAnchors: () => [],
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
            this.options.getAnchors(),
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
        key: new PluginKey('anchorHighlightClick'),
        props: {
          handleDOMEvents: {
            click: (view, event) => {
              const target = event.target;
              if (!(target instanceof Element)) return false;
              const note = target.closest('.anchor-note');
              if (note && view.dom.contains(note)) {
                const ids = annotationIdsFromAnchor(note);
                if (ids.length > 0) {
                  this.options.onAnnotationClick(ids);
                  return true;
                }
              }
              const hit = target.closest('.anchor');
              if (!hit || !view.dom.contains(hit)) return false;
              const ids = cardIdsFromAnchor(hit);
              if (ids.length === 0) return false;
              this.options.onAnchorClick(ids);
              return true;
            },
          },
        },
      }),
    ];
  },
});
