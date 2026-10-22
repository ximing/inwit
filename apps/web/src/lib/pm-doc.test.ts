import { EMPTY_PM_DOC } from '@inwit/dto';
import { describe, expect, it } from 'vitest';
import { jsonEqual, textToPmDoc } from './pm-doc';
import { isBlankPmDoc } from './pm-doc-read';

describe('isBlankPmDoc', () => {
  it('treats empty and ZWSP docs as blank', () => {
    expect(isBlankPmDoc(EMPTY_PM_DOC)).toBe(true);
    expect(
      isBlankPmDoc({
        type: 'doc',
        content: [{ type: 'paragraph', content: [{ type: 'text', text: '\u200b' }] }],
      }),
    ).toBe(true);
    expect(isBlankPmDoc(textToPmDoc('正文'))).toBe(false);
    expect(
      isBlankPmDoc({
        type: 'doc',
        content: [
          {
            type: 'table',
            content: [
              {
                type: 'tableRow',
                content: [
                  {
                    type: 'tableCell',
                    content: [{ type: 'paragraph' }],
                  },
                ],
              },
            ],
          },
        ],
      }),
    ).toBe(false);
    expect(
      isBlankPmDoc({
        type: 'doc',
        content: [
          {
            type: 'paragraph',
            content: [{ type: 'image', attrs: { src: 'asset:pic', alt: null, width: 480, height: 240 } }],
          },
        ],
      }),
    ).toBe(false);
  });
});

describe('jsonEqual', () => {
  it('treats different key order as equal', () => {
    expect(jsonEqual({ type: 'text', text: '甲' }, { text: '甲', type: 'text' })).toBe(true);
  });

  it('treats different text as unequal', () => {
    expect(jsonEqual({ type: 'text', text: '甲' }, { type: 'text', text: '乙' })).toBe(false);
  });

  it('treats a different paragraph order as unequal', () => {
    const first = {
      type: 'doc',
      content: [
        { type: 'paragraph', content: [{ type: 'text', text: '甲' }] },
        { type: 'paragraph', content: [{ type: 'text', text: '乙' }] },
      ],
    };
    const swapped = {
      type: 'doc',
      content: [
        { type: 'paragraph', content: [{ type: 'text', text: '乙' }] },
        { type: 'paragraph', content: [{ type: 'text', text: '甲' }] },
      ],
    };
    expect(jsonEqual(first, swapped)).toBe(false);
  });
});

describe('textToPmDoc', () => {
  it('splits blank lines into paragraphs', () => {
    expect(textToPmDoc('甲\n\n乙')).toEqual({
      type: 'doc',
      content: [
        { type: 'paragraph', content: [{ type: 'text', text: '甲' }] },
        { type: 'paragraph', content: [{ type: 'text', text: '乙' }] },
      ],
    });
  });
});
