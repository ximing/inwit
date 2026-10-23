import { EMPTY_PM_DOC } from '@inwit/dto';
import { describe, expect, it } from 'vitest';
import { isBlankPmDoc, jsonEqual, textToPmDoc } from './pm-doc';

describe('isBlankPmDoc', () => {
  it('treats empty text, empty math, a rule, and a nested page break as blank', () => {
    expect(isBlankPmDoc(EMPTY_PM_DOC)).toBe(true);
    expect(
      isBlankPmDoc({
        type: 'doc',
        content: [{ type: 'paragraph', content: [{ type: 'text', text: '\u200b' }] }],
      }),
    ).toBe(true);
    expect(
      isBlankPmDoc({
        type: 'doc',
        content: [{ type: 'paragraph', content: [{ type: 'inlineMath', attrs: { latex: '  ' } }] }],
      }),
    ).toBe(true);
    expect(
      isBlankPmDoc({
        type: 'doc',
        content: [{ type: 'blockMath', attrs: { latex: '' } }],
      }),
    ).toBe(true);
    expect(
      isBlankPmDoc({
        type: 'doc',
        content: [{ type: 'inlineMath', attrs: { latex: 1 } }],
      }),
    ).toBe(true);
    expect(isBlankPmDoc({ type: 'doc', content: [{ type: 'horizontalRule' }] })).toBe(true);
    expect(
      isBlankPmDoc({
        type: 'doc',
        content: [{ type: 'blockquote', content: [{ type: 'pageBreak', attrs: { pageIndex: 1 } }] }],
      }),
    ).toBe(true);
  });

  it('treats formula latex, a top-level page break, media, and a table as content', () => {
    expect(isBlankPmDoc(textToPmDoc('正文'))).toBe(false);
    expect(
      isBlankPmDoc({
        type: 'doc',
        content: [
          { type: 'paragraph', content: [{ type: 'inlineMath', attrs: { latex: 'E=mc^2' } }] },
        ],
      }),
    ).toBe(false);
    expect(
      isBlankPmDoc({
        type: 'doc',
        content: [{ type: 'blockMath', attrs: { latex: '\\frac{1}{2}' } }],
      }),
    ).toBe(false);
    expect(
      isBlankPmDoc({
        type: 'doc',
        content: [{ type: 'pageBreak', attrs: { pageIndex: 1 } }],
      }),
    ).toBe(false);
    expect(
      isBlankPmDoc({
        type: 'doc',
        content: [{ type: 'paragraph' }, { type: 'pageBreak', attrs: { pageIndex: 2 } }],
      }),
    ).toBe(false);
    expect(
      isBlankPmDoc({
        type: 'doc',
        content: [{ type: 'paragraph', content: [{ type: 'image', attrs: { src: 'asset:pic' } }] }],
      }),
    ).toBe(false);
    expect(
      isBlankPmDoc({
        type: 'doc',
        content: [
          {
            type: 'table',
            content: [
              {
                type: 'tableRow',
                content: [{ type: 'tableCell', content: [{ type: 'paragraph' }] }],
              },
            ],
          },
        ],
      }),
    ).toBe(false);
  });
});

describe('jsonEqual', () => {
  it('ignores key order and still sees different text', () => {
    expect(jsonEqual({ type: 'text', text: '甲' }, { text: '甲', type: 'text' })).toBe(true);
    expect(jsonEqual({ type: 'text', text: '甲' }, { type: 'text', text: '乙' })).toBe(false);
  });
});
