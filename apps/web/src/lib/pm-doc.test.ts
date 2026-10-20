import { EMPTY_PM_DOC } from '@inwit/dto';
import { describe, expect, it } from 'vitest';
import { textToPmDoc } from './pm-doc';
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
