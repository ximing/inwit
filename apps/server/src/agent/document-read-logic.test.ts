import { describe, expect, it } from 'vitest';
import type { DocBlock } from '@inwit/doc-schema';
import { formatNumberedBlockView } from './card-anchor-logic.js';
import { sliceNumberedDocument, UNREAD_PAGE_LIMIT } from './document-read-logic.js';

function block(index: number, pageIndex: number, text: string): DocBlock {
  return { index, pageIndex, text };
}

function chars(text: string): number {
  return [...text].length;
}

describe('sliceNumberedDocument', () => {
  const intro = block(1, 1, '全文路线图提到 §5');
  const breakOnPage1 = block(2, 1, '');
  const section = block(3, 2, '5 Scheduling across the fleet');
  const detail = block(4, 2, 'The scheduler places each task.');

  it('stops on a block boundary and lists later pages', () => {
    const first = formatNumberedBlockView([intro]);
    const second = formatNumberedBlockView([breakOnPage1]);
    const view = sliceNumberedDocument([intro, breakOnPage1, section, detail], {
      maxChars: chars(first) + 1 + chars(second),
    });
    expect(view.text).toBe(`${first}\n${second}`);
    expect(view.text).not.toContain('Scheduling');
    expect(view.truncated).toBe(true);
    expect(view.throughBlock).toBe(2);
    expect(view.nextBlock).toBe(3);
    expect(view.unreadPageCount).toBe(1);
    expect(view.unreadPages).toEqual([
      { page: 2, blockIndex: 3, line: '5 Scheduling across the fleet' },
    ]);
  });

  it('returns an oversized first block whole', () => {
    const huge = block(1, 1, 'x'.repeat(80));
    const view = sliceNumberedDocument([huge, section], { maxChars: 10 });
    expect(view.text).toContain('x'.repeat(80));
    expect(view.text).not.toContain('…');
    expect(view.truncated).toBe(true);
    expect(view.nextBlock).toBe(3);
    expect(view.throughBlock).toBe(1);
  });

  it('points a partly read page at the next block', () => {
    const view = sliceNumberedDocument([intro, breakOnPage1, section, detail], {
      maxChars: chars(formatNumberedBlockView([intro])),
    });
    expect(view.throughBlock).toBe(1);
    expect(view.unreadPages).toEqual([
      { page: 1, blockIndex: 2, line: '' },
      { page: 2, blockIndex: 3, line: '5 Scheduling across the fleet' },
    ]);
  });

  it('reads a later block without listing pages already passed', () => {
    const view = sliceNumberedDocument([intro, breakOnPage1, section, detail], { fromBlock: 3 });
    expect(view.fromBlock).toBe(3);
    expect(view.truncated).toBe(false);
    expect(view.throughBlock).toBe(4);
    expect(view.nextBlock).toBeNull();
    expect(view.unreadPages).toEqual([]);
    expect(view.text).toContain('5 Scheduling across the fleet');
    expect(view.text).not.toContain('路线图');
  });

  it('returns an empty slice when fromBlock is past the end', () => {
    const view = sliceNumberedDocument([intro, section], { fromBlock: 9 });
    expect(view).toMatchObject({
      text: '',
      fromBlock: 9,
      throughBlock: null,
      nextBlock: null,
      blockCount: 2,
      truncated: false,
      unreadPages: [],
      unreadPageCount: 0,
    });
  });

  it('clips a page line and caps the unread list', () => {
    const pages = Array.from({ length: UNREAD_PAGE_LIMIT + 2 }, (_, index) =>
      block(index + 1, index + 1, `第 ${String(index + 1)} 页 ${'甲'.repeat(50)}`),
    );
    const view = sliceNumberedDocument(pages, { maxChars: 1 });
    expect(view.truncated).toBe(true);
    expect(view.throughBlock).toBe(1);
    expect(view.unreadPageCount).toBe(UNREAD_PAGE_LIMIT + 1);
    expect(view.unreadPages).toHaveLength(UNREAD_PAGE_LIMIT);
    expect(view.unreadPages[0]).toMatchObject({ page: 2, blockIndex: 2 });
    expect(view.unreadPages[0]!.line.endsWith('…')).toBe(true);
    expect([...view.unreadPages[0]!.line].length).toBe(41);
  });
});
