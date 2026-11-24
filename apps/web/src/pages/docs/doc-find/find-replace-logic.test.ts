import { getHeadlessSchema, type PmJson } from '@inwit/doc-schema';
import { history, undo } from '@tiptap/pm/history';
import { Node } from '@tiptap/pm/model';
import { EditorState, type Transaction } from '@tiptap/pm/state';
import { describe, expect, it } from 'vitest';
import { docFindKey, docFindPlugin, readDocFind } from './doc-find-plugin';
import {
  applyHitReplace,
  applyHitsReplace,
  findKeywordHits,
  findResultLabel,
  findSeedFromSelection,
  foldForMatch,
  keywordSpans,
  nextHitIndex,
  type FindHit,
} from './find-replace-logic';

function doc(...content: PmJson[]): PmJson {
  return { type: 'doc', content };
}

function p(text: string): PmJson {
  return { type: 'paragraph', content: text ? [{ type: 'text', text }] : [] };
}

function nodeFrom(json: PmJson): Node {
  return Node.fromJSON(getHeadlessSchema(), json);
}

function latexOf(node: Node): string {
  let latex = '';
  node.descendants((child) => {
    if (child.type.name === 'inlineMath' || child.type.name === 'blockMath') {
      latex = String(child.attrs.latex ?? '');
    }
  });
  return latex;
}

function hitText(node: Node, hit: FindHit): string {
  if (hit.kind === 'attr') {
    const atom = node.nodeAt(hit.from);
    const value = atom?.attrs[hit.attr ?? ''];
    return typeof value === 'string' ? value.slice(hit.attrFrom, hit.attrTo) : '';
  }
  return node.textBetween(hit.from, hit.to);
}

function withFind(node: Node, query: string, caseSensitive = false) {
  const hits = findKeywordHits(node, query, caseSensitive);
  let state = EditorState.create({
    schema: node.type.schema,
    doc: node,
    plugins: [history(), docFindPlugin()],
  });
  state = state.apply(
    state.tr.setMeta(docFindKey, {
      query,
      caseSensitive,
      hits,
      index: 0,
    }),
  );
  return state;
}

describe('keywordSpans', () => {
  it('matches case-insensitively without overlapping', () => {
    expect(foldForMatch('AbC', false)).toBe('abc');
    expect(keywordSpans('aaaa', { query: 'aa', caseSensitive: false })).toEqual([
      { start: 0, end: 2 },
      { start: 2, end: 4 },
    ]);
    expect(keywordSpans('Hello', { query: 'hello', caseSensitive: true })).toEqual([]);
    expect(keywordSpans('Hello', { query: 'hello', caseSensitive: false })).toEqual([
      { start: 0, end: 5 },
    ]);
  });

  it('keeps indexes aligned when a character would grow while folding', () => {
    const text = 'AİB';
    expect(foldForMatch(text, false)).toHaveLength(text.length);
    expect(keywordSpans(text, { query: 'i', caseSensitive: false })).toEqual([]);
  });
});

describe('findKeywordHits', () => {
  it('finds text, including a match split by a mark, and skips paragraph boundaries', () => {
    const schema = getHeadlessSchema();
    const bold = schema.marks.bold!.create();
    const node = schema.node('doc', null, [
      schema.node('paragraph', null, [
        schema.text('hel'),
        schema.text('lo', [bold]),
        schema.text(' world'),
      ]),
      schema.node('paragraph', null, [schema.text('hello')]),
    ]);
    const hits = findKeywordHits(node, 'hello', false);
    expect(hits.map((hit) => hitText(node, hit))).toEqual(['hello', 'hello']);
    expect(node.textBetween(hits[0]!.from, hits[0]!.to)).toBe('hello');
    const split = nodeFrom(doc(p('ab'), p('cd')));
    expect(findKeywordHits(split, 'bc', false)).toEqual([]);
  });

  it('matches Chinese keywords as substrings and code text', () => {
    const node = nodeFrom(
      doc(p('机器学习'), { type: 'codeBlock', content: [{ type: 'text', text: 'const alpha = 1' }] }),
    );
    expect(findKeywordHits(node, '学习', false).map((hit) => hitText(node, hit))).toEqual(['学习']);
    expect(findKeywordHits(node, 'alpha', true)).toHaveLength(1);
  });

  it('searches formula source and image alt without crossing into nearby prose', () => {
    const schema = getHeadlessSchema();
    const node = schema.node('doc', null, [
      schema.node('paragraph', null, [
        schema.text('见 '),
        schema.node('inlineMath', { latex: 'E=mc^2' }),
      ]),
      schema.node('blockMath', { latex: '\\alpha+\\beta' }),
      schema.node('paragraph', null, [
        schema.node('image', { src: 'https://example.com/a.png', alt: '示意图' }),
      ]),
    ]);
    const mathHits = findKeywordHits(node, 'mc', false);
    expect(mathHits).toHaveLength(1);
    expect(mathHits[0]).toMatchObject({ kind: 'attr', attr: 'latex', attrFrom: 2, attrTo: 4 });
    expect(findKeywordHits(node, 'alpha', false)[0]).toMatchObject({ kind: 'attr', attr: 'latex' });
    expect(findKeywordHits(node, '示意', false)[0]).toMatchObject({ kind: 'attr', attr: 'alt' });
    expect(findKeywordHits(node, '见 E', false)).toEqual([]);
  });

  it('returns nothing for an empty query', () => {
    expect(findKeywordHits(nodeFrom(doc(p('hello'))), '', false)).toEqual([]);
    expect(findResultLabel(0, 0, '')).toBe('');
    expect(findResultLabel(0, 0, 'a')).toBe('无匹配');
    expect(findResultLabel(1, 3, 'a')).toBe('2/3');
  });
});

describe('findSeedFromSelection', () => {
  it('uses a short single-block selection and ignores a cursor or a cross-block range', () => {
    const node = nodeFrom(doc(p('hello world'), p('next')));
    expect(findSeedFromSelection(node, 1, 6)).toBe('hello');
    expect(findSeedFromSelection(node, 1, 1)).toBeNull();
    expect(findSeedFromSelection(node, 1, node.content.size)).toBeNull();
  });
});

describe('replace', () => {
  it('replaces the current hit, keeps its marks, and steps past the insertion', () => {
    const schema = getHeadlessSchema();
    const bold = schema.marks.bold!.create();
    const node = schema.node('doc', null, [
      schema.node('paragraph', null, [
        schema.text('say '),
        schema.text('hello', [bold]),
        schema.text(' hello'),
      ]),
    ]);
    const hits = findKeywordHits(node, 'hello', false);
    const tr = EditorState.create({ schema, doc: node }).tr;
    applyHitReplace(tr, hits[0]!, 'earth');
    const text = tr.doc.textBetween(0, tr.doc.content.size);
    expect(text).toBe('say earth hello');
    const replaced = tr.doc.textBetween(hits[0]!.from, hits[0]!.from + 'earth'.length);
    expect(replaced).toBe('earth');
    expect(tr.doc.resolve(hits[0]!.from + 1).marks().map((mark) => mark.type.name)).toEqual(['bold']);
    const nextHits = findKeywordHits(tr.doc, 'hello', false);
    const mappedEnd = tr.mapping.map(hits[0]!.to, 1);
    expect(nextHitIndex(nextHits, hits[0]!, 'earth'.length, mappedEnd)).toBe(0);
    expect(nextHits[0] && tr.doc.textBetween(nextHits[0].from, nextHits[0].to)).toBe('hello');
  });

  it('replaces every hit in one undo step, including a formula source', () => {
    const schema = getHeadlessSchema();
    const node = schema.node('doc', null, [
      schema.node('paragraph', null, [schema.text('a a')]),
      schema.node('paragraph', null, [schema.node('inlineMath', { latex: 'a+a' })]),
    ]);
    let state = EditorState.create({
      schema,
      doc: node,
      plugins: [history(), docFindPlugin()],
    });
    const hits = findKeywordHits(state.doc, 'a', false);
    expect(hits).toHaveLength(4);
    const tr = state.tr;
    applyHitsReplace(tr, hits, 'b');
    tr.setMeta('docFind', {
      query: 'a',
      caseSensitive: false,
      hits: findKeywordHits(tr.doc, 'a', false),
      index: 0,
    });
    state = state.apply(tr);
    expect(state.doc.textContent.startsWith('b b')).toBe(true);
    expect(latexOf(state.doc)).toBe('b+b');
    const inverse = undo(state, (next: Transaction) => {
      state = state.apply(next);
    });
    expect(inverse).toBe(true);
    expect(state.doc.textContent.startsWith('a a')).toBe(true);
    expect(latexOf(state.doc)).toBe('a+a');
  });

  it('does not loop when the replacement still contains the keyword', () => {
    const node = nodeFrom(doc(p('a')));
    const hits = findKeywordHits(node, 'a', true);
    const tr = EditorState.create({ doc: node }).tr;
    applyHitsReplace(tr, hits, 'a+');
    const again = findKeywordHits(tr.doc, 'a', true);
    expect(again).toHaveLength(1);
    expect(tr.doc.textContent).toBe('a+');
  });

  it('recomputes highlights when the document changes under an open query', () => {
    const node = nodeFrom(doc(p('hello')));
    let state = withFind(node, 'hello', false);
    expect(readDocFind(state).hits).toHaveLength(1);
    state = state.apply(state.tr.insertText('!', 6));
    expect(state.doc.textContent).toBe('hello!');
    expect(readDocFind(state).hits).toHaveLength(1);
    state = state.apply(state.tr.insertText('x', 1, 6));
    expect(readDocFind(state).hits).toHaveLength(0);
  });
});
