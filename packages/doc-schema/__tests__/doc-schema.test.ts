import { Node } from 'prosemirror-model';
import { EditorState } from 'prosemirror-state';
import { describe, expect, it } from 'vitest';
import {
  applyEntityAnchor,
  blocksFromPmJSON,
  findEntityAnchors,
  getHeadlessSchema,
  locateQuote,
  pmJsonToText,
  stripEntityAnchors,
  thematicBreaksToPageBreaks,
  type PmJson,
  type PmMarkJson,
} from '../src/index.js';

function doc(...content: PmJson[]): PmJson {
  return { type: 'doc', content };
}

function p(...content: PmJson[]): PmJson {
  return { type: 'paragraph', content };
}

function t(text: string, marks?: PmMarkJson[]): PmJson {
  const node: PmJson = { type: 'text', text };
  if (marks && marks.length > 0) node.marks = marks;
  return node;
}

function posOf(source: PmJson, needle: string): { from: number; to: number } {
  const pm = Node.fromJSON(getHeadlessSchema(), source);
  let found: { from: number; to: number } | undefined;
  pm.descendants((node, pos) => {
    if (found || !node.isText || !node.text) return;
    const i = node.text.indexOf(needle);
    if (i < 0) return;
    found = { from: pos + i, to: pos + i + needle.length };
  });
  if (!found) throw new Error(`needle not in doc: ${needle}`);
  return found;
}

function insertTextAt(source: PmJson, pos: number, text: string): PmJson {
  const pm = Node.fromJSON(getHeadlessSchema(), source);
  const state = EditorState.create({ doc: pm });
  return state.tr.insertText(text, pos).doc.toJSON() as PmJson;
}

function textMarks(node: PmJson): { text: string; marks: PmMarkJson[] }[] {
  const acc: { text: string; marks: PmMarkJson[] }[] = [];
  const walk = (current: PmJson): void => {
    if (current.type === 'text') acc.push({ text: current.text ?? '', marks: current.marks ?? [] });
    for (const child of current.content ?? []) walk(child);
  };
  walk(node);
  return acc;
}

const TWO_PAGES = doc(
  p(t('第一页正文')),
  { type: 'pageBreak', attrs: { pageIndex: 1 } },
  p(t('第二页开头'), { type: 'hardBreak' }, t('换行后')),
  { type: 'pageBreak', attrs: { pageIndex: 2 } },
  p(t('before'), { type: 'image', attrs: { src: 'https://example.com/a.png' } }, t('after')),
  { type: 'video', attrs: { src: 'https://example.com/a.mp4', mime: 'video/mp4' } },
);

describe('blocksFromPmJSON', () => {
  it('numbers top-level blocks 1-based and increments pageIndex after each pageBreak', () => {
    expect(blocksFromPmJSON(TWO_PAGES)).toEqual([
      { index: 1, pageIndex: 1, text: '第一页正文' },
      { index: 2, pageIndex: 1, text: '' },
      { index: 3, pageIndex: 2, text: '第二页开头\n换行后' },
      { index: 4, pageIndex: 2, text: '' },
      { index: 5, pageIndex: 3, text: 'beforeafter' },
      { index: 6, pageIndex: 3, text: '' },
    ]);
  });
});

describe('pmJsonToText', () => {
  it('joins block text with blank lines and renders pageBreak as 第 N 页', () => {
    expect(pmJsonToText(TWO_PAGES)).toBe(
      [
        '第一页正文',
        '--- 第 1 页 ---',
        '第二页开头\n换行后',
        '--- 第 2 页 ---',
        'beforeafter',
        '',
      ].join('\n\n'),
    );
  });
});

describe('locateQuote', () => {
  const source = doc(p(t('hello world')), p(t('second block')));

  it('finds an exact quote inside the given top-level block and returns absolute PM positions', () => {
    expect(locateQuote(source, 1, 'hello')).toEqual(posOf(source, 'hello'));
    expect(locateQuote(source, 1, 'world')).toEqual(posOf(source, 'world'));
    expect(locateQuote(source, 2, 'second block')).toEqual(posOf(source, 'second block'));
  });

  it('falls back to whitespace-tolerant match within the block', () => {
    expect(locateQuote(source, 1, 'hello  world')).toEqual(posOf(source, 'hello world'));
    expect(locateQuote(source, 1, 'hello\nworld')).toEqual(posOf(source, 'hello world'));
  });

  it('does not search outside the specified block', () => {
    expect(locateQuote(source, 1, 'second')).toBeNull();
    expect(locateQuote(source, 2, 'hello')).toBeNull();
  });

  it('returns null when the quote is missing or the block does not exist', () => {
    expect(locateQuote(source, 1, 'missing')).toBeNull();
    expect(locateQuote(source, 9, 'hello')).toBeNull();
    expect(locateQuote(source, 1, '')).toBeNull();
  });
});

describe('applyEntityAnchor', () => {
  it('adds an annotationMark on the located range', () => {
    const source = doc(p(t('alpha beta gamma')));
    const range = locateQuote(source, 1, 'beta');
    expect(range).not.toBeNull();
    const next = applyEntityAnchor(source, 'annotation', 'note-1', range!);
    expect(findEntityAnchors(next)).toEqual([{ kind: 'annotation', ids: ['note-1'], ...range! }]);
    expect(textMarks(next)).toEqual([
      { text: 'alpha ', marks: [] },
      { text: 'beta', marks: [{ type: 'annotationMark', attrs: { annotationId: 'note-1' } }] },
      { text: ' gamma', marks: [] },
    ]);
  });

  it('merges overlapping cardAnchor cardIds and de-duplicates', () => {
    const source = doc(p(t('alpha beta gamma')));
    const first = locateQuote(source, 1, 'alpha beta');
    expect(first).not.toBeNull();
    const withC1 = applyEntityAnchor(source, 'card', 'c1', first!);
    const second = locateQuote(withC1, 1, 'beta gamma');
    expect(second).not.toBeNull();
    const withC2 = applyEntityAnchor(withC1, 'card', 'c2', second!);
    const again = applyEntityAnchor(withC2, 'card', 'c1', second!);

    expect(textMarks(withC2)).toEqual([
      { text: 'alpha ', marks: [{ type: 'cardAnchor', attrs: { cardIds: ['c1'] } }] },
      { text: 'beta gamma', marks: [{ type: 'cardAnchor', attrs: { cardIds: ['c1', 'c2'] } }] },
    ]);
    expect(textMarks(again)[1]?.marks).toEqual([{ type: 'cardAnchor', attrs: { cardIds: ['c1', 'c2'] } }]);
    expect(findEntityAnchors(withC2)).toEqual([
      { kind: 'card', ids: ['c1'], from: first!.from, to: second!.from },
      { kind: 'card', ids: ['c1', 'c2'], from: second!.from, to: second!.to },
    ]);
  });
});

describe('findEntityAnchors', () => {
  it('scans consecutive annotation and card mark ranges', () => {
    const source = doc(
      p(
        t('aa', [{ type: 'annotationMark', attrs: { annotationId: 'n1' } }]),
        t('bb', [
          { type: 'annotationMark', attrs: { annotationId: 'n1' } },
          { type: 'cardAnchor', attrs: { cardIds: ['c1', 'c2'] } },
        ]),
        t('cc'),
      ),
    );
    const aa = posOf(source, 'aa');
    const bb = posOf(source, 'bb');
    expect(findEntityAnchors(source)).toEqual([
      { kind: 'annotation', ids: ['n1'], from: aa.from, to: bb.to },
      { kind: 'card', ids: ['c1', 'c2'], from: bb.from, to: bb.to },
    ]);
  });
});

describe('stripEntityAnchors', () => {
  it('removes entity marks and keeps other marks', () => {
    const source = doc(
      p(
        t('keep', [
          { type: 'bold' },
          { type: 'annotationMark', attrs: { annotationId: 'n1' } },
          { type: 'cardAnchor', attrs: { cardIds: ['c1'] } },
        ]),
        t('plain'),
      ),
    );
    expect(stripEntityAnchors(source)).toEqual(doc(p(t('keep', [{ type: 'bold' }]), t('plain'))));
  });
});

describe('entity mark inclusive', () => {
  it('does not expand annotationMark or cardAnchor when inserting at the mark boundary', () => {
    const schema = getHeadlessSchema();
    expect(schema.marks['annotationMark']?.spec.inclusive).toBe(false);
    expect(schema.marks['cardAnchor']?.spec.inclusive).toBe(false);

    const source = doc(p(t('hello')));
    const range = locateQuote(source, 1, 'hello');
    expect(range).not.toBeNull();

    const annotated = applyEntityAnchor(source, 'annotation', 'n1', range!);
    const afterStart = insertTextAt(annotated, range!.from, 'X');
    expect(findEntityAnchors(afterStart)).toEqual([
      { kind: 'annotation', ids: ['n1'], from: range!.from + 1, to: range!.to + 1 },
    ]);
    expect(textMarks(afterStart)).toEqual([
      { text: 'X', marks: [] },
      { text: 'hello', marks: [{ type: 'annotationMark', attrs: { annotationId: 'n1' } }] },
    ]);

    const afterEnd = insertTextAt(annotated, range!.to, 'Y');
    expect(findEntityAnchors(afterEnd)).toEqual([{ kind: 'annotation', ids: ['n1'], ...range! }]);
    expect(textMarks(afterEnd)).toEqual([
      { text: 'hello', marks: [{ type: 'annotationMark', attrs: { annotationId: 'n1' } }] },
      { text: 'Y', marks: [] },
    ]);

    const carded = applyEntityAnchor(source, 'card', 'c1', range!);
    const afterCardStart = insertTextAt(carded, range!.from, 'X');
    expect(findEntityAnchors(afterCardStart)).toEqual([
      { kind: 'card', ids: ['c1'], from: range!.from + 1, to: range!.to + 1 },
    ]);
    expect(textMarks(afterCardStart)).toEqual([
      { text: 'X', marks: [] },
      { text: 'hello', marks: [{ type: 'cardAnchor', attrs: { cardIds: ['c1'] } }] },
    ]);
  });
});

describe('thematicBreaksToPageBreaks', () => {
  it('replaces top-level thematicBreak nodes with numbered pageBreaks', () => {
    const source = doc(
      p(t('a')),
      { type: 'thematicBreak' },
      p(t('b')),
      { type: 'thematicBreak' },
      {
        type: 'blockquote',
        content: [{ type: 'thematicBreak' }],
      },
    );
    expect(thematicBreaksToPageBreaks(source)).toEqual(
      doc(
        p(t('a')),
        { type: 'pageBreak', attrs: { pageIndex: 1 } },
        p(t('b')),
        { type: 'pageBreak', attrs: { pageIndex: 2 } },
        {
          type: 'blockquote',
          content: [{ type: 'thematicBreak' }],
        },
      ),
    );
  });
});
