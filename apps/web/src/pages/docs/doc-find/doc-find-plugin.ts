import { Extension } from '@tiptap/core';
import type { Editor } from '@tiptap/core';
import type { Node as PmNode } from '@tiptap/pm/model';
import { Plugin, PluginKey, type EditorState, type Transaction } from '@tiptap/pm/state';
import { Decoration, DecorationSet, type EditorView } from '@tiptap/pm/view';
import {
  applyHitReplace,
  applyHitsReplace,
  findKeywordHits,
  nextHitIndex,
  type FindHit,
} from './find-replace-logic';

export type DocFindState = {
  query: string;
  caseSensitive: boolean;
  hits: FindHit[];
  index: number;
};

const EMPTY: DocFindState = { query: '', caseSensitive: false, hits: [], index: 0 };

export const docFindKey = new PluginKey<DocFindState>('docFind');

export function readDocFind(state: EditorState): DocFindState {
  return docFindKey.getState(state) ?? EMPTY;
}

function hitsEqual(a: readonly FindHit[], b: readonly FindHit[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) {
    const x = a[i]!;
    const y = b[i]!;
    if (
      x.from !== y.from ||
      x.to !== y.to ||
      x.kind !== y.kind ||
      x.attrFrom !== y.attrFrom ||
      x.attrTo !== y.attrTo
    ) {
      return false;
    }
  }
  return true;
}

function indexAfterDocChange(prev: DocFindState, hits: FindHit[], tr: Transaction): number {
  if (hits.length === 0) return 0;
  const old = prev.hits[prev.index];
  if (!old) return Math.min(prev.index, hits.length - 1);
  const mapped = tr.mapping.map(old.from, 1);
  const next = hits.findIndex((hit) => hit.from >= mapped);
  return next >= 0 ? next : 0;
}

function buildDecorations(doc: PmNode, find: DocFindState): DecorationSet {
  const decos: Decoration[] = [];
  const currentAttr = new Set<number>();
  const current = find.hits[find.index];
  if (current?.kind === 'attr') currentAttr.add(current.from);
  const attrSeen = new Set<number>();
  find.hits.forEach((hit, index) => {
    if (hit.kind === 'text') {
      if (hit.from >= hit.to) return;
      const cls = index === find.index ? 'doc-find-hit is-current' : 'doc-find-hit';
      decos.push(Decoration.inline(hit.from, hit.to, { class: cls }));
      return;
    }
    if (attrSeen.has(hit.from)) return;
    attrSeen.add(hit.from);
    const node = doc.nodeAt(hit.from);
    if (!node || node.isText) return;
    const cls = currentAttr.has(hit.from) ? 'doc-find-hit is-current' : 'doc-find-hit';
    decos.push(Decoration.node(hit.from, hit.from + node.nodeSize, { class: cls }));
  });
  if (decos.length === 0) return DecorationSet.empty;
  return DecorationSet.create(doc, decos);
}

export function docFindPlugin(): Plugin<DocFindState> {
  return new Plugin({
    key: docFindKey,
    state: {
      init: () => EMPTY,
      apply(tr, prev) {
        const meta = tr.getMeta(docFindKey) as DocFindState | 'clear' | undefined;
        if (meta === 'clear') return { ...EMPTY, caseSensitive: prev.caseSensitive };
        if (meta && typeof meta === 'object') return meta;
        if (!tr.docChanged || prev.query.length === 0) return prev;
        const hits = findKeywordHits(tr.doc, prev.query, prev.caseSensitive);
        const index = indexAfterDocChange(prev, hits, tr);
        if (index === prev.index && hitsEqual(hits, prev.hits)) return prev;
        return { ...prev, hits, index };
      },
    },
    props: {
      decorations(state) {
        const find = docFindKey.getState(state);
        if (!find || find.hits.length === 0) return null;
        return buildDecorations(state.doc, find);
      },
    },
  });
}

export const DocFind = Extension.create({
  name: 'docFind',
  addProseMirrorPlugins() {
    return [docFindPlugin()];
  },
});

function editorView(editor: Editor): EditorView | null {
  if (editor.isDestroyed) return null;
  try {
    return editor.view;
  } catch {
    return null;
  }
}

/**
 * TipTap 在阅读态可能先后创建两个 Editor，后一个才把视图挂进 DOM。
 * 查找必须打在 `dom.editor` 上，否则事务会套到已经拆掉的那份文档上。
 */
export function mountedEditor(editor: Editor): Editor {
  if (editor.isDestroyed) return editor;
  try {
    const dom = editor.view.dom as HTMLElement & { editor?: Editor };
    const live = dom.editor;
    if (live && !live.isDestroyed) return live;
  } catch {
    // 视图还没挂上。
  }
  return editor;
}

function liveView(editor: Editor): { editor: Editor; view: EditorView } | null {
  const live = mountedEditor(editor);
  const view = editorView(live);
  if (!view) return null;
  return { editor: live, view };
}

export function publishDocFind(editor: Editor, query: string, caseSensitive: boolean): DocFindState | null {
  const live = liveView(editor);
  if (!live) return null;
  const { view } = live;
  const hits = findKeywordHits(view.state.doc, query, caseSensitive);
  const next: DocFindState = { query, caseSensitive, hits, index: 0 };
  const current = readDocFind(view.state);
  if (
    current.query === next.query &&
    current.caseSensitive === next.caseSensitive &&
    current.index === next.index &&
    hitsEqual(current.hits, hits)
  ) {
    return current;
  }
  // 事务必须从 TipTap 即将套用的那份 state 上创建，不能用可能已经分叉的 view.state。
  const tr = live.editor.state.tr.setMeta(docFindKey, next).setMeta('addToHistory', false);
  view.dispatch(tr);
  return next;
}

export function clearDocFind(editor: Editor): void {
  const live = liveView(editor);
  if (!live) return;
  const current = readDocFind(live.view.state);
  if (current.query.length === 0 && current.hits.length === 0) return;
  const tr = live.editor.state.tr.setMeta(docFindKey, 'clear').setMeta('addToHistory', false);
  live.view.dispatch(tr);
}

export function scrollFindHitIntoView(editor: Editor, hit: FindHit): void {
  const view = editorView(mountedEditor(editor));
  if (!view) return;
  let top = 0;
  let bottom = 0;
  try {
    const coords = view.coordsAtPos(hit.from);
    top = coords.top;
    bottom = coords.bottom;
  } catch {
    return;
  }
  const scroller = view.dom.closest('.pane-scroll');
  if (!(scroller instanceof HTMLElement)) return;
  const box = scroller.getBoundingClientRect();
  const padding = 72;
  if (top >= box.top + padding && bottom <= box.bottom - padding) return;
  scroller.scrollTop += top - box.top - Math.min(120, box.height / 3);
}

export function stepDocFind(editor: Editor, delta: number): void {
  const live = liveView(editor);
  if (!live) return;
  const current = readDocFind(live.editor.state);
  if (current.hits.length === 0) return;
  const index = (current.index + delta + current.hits.length) % current.hits.length;
  const hit = current.hits[index];
  if (!hit) return;
  const tr = live.editor.state.tr.setMeta(docFindKey, { ...current, index }).setMeta('addToHistory', false);
  live.view.dispatch(tr);
  scrollFindHitIntoView(live.editor, hit);
}

function dispatchReplace(editor: Editor, tr: Transaction, next: DocFindState): void {
  const live = liveView(editor);
  if (!live) return;
  tr.setMeta(docFindKey, next);
  live.view.dispatch(tr);
  const hit = next.hits[next.index];
  if (hit) scrollFindHitIntoView(live.editor, hit);
}

export function replaceCurrentHit(editor: Editor, replacement: string): number {
  const live = liveView(editor);
  if (!live) return 0;
  const current = readDocFind(live.editor.state);
  const hit = current.hits[current.index];
  if (!current.query || !hit) return 0;
  const tr = live.editor.state.tr;
  applyHitReplace(tr, hit, replacement);
  const mappedEnd = tr.mapping.map(hit.to, 1);
  const hits = findKeywordHits(tr.doc, current.query, current.caseSensitive);
  const index = nextHitIndex(hits, hit, replacement.length, mappedEnd);
  dispatchReplace(live.editor, tr, { ...current, hits, index });
  return 1;
}

export function replaceAllHits(editor: Editor, replacement: string): number {
  const live = liveView(editor);
  if (!live) return 0;
  const current = readDocFind(live.editor.state);
  if (!current.query || current.hits.length === 0) return 0;
  const count = current.hits.length;
  const tr = live.editor.state.tr;
  applyHitsReplace(tr, current.hits, replacement);
  const hits = findKeywordHits(tr.doc, current.query, current.caseSensitive);
  dispatchReplace(live.editor, tr, { ...current, hits, index: 0 });
  return count;
}
