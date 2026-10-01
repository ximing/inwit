import { describe, expect, it } from 'vitest';
import { parseAssistantMarkdown, safeHref, safeImageSrc, type MdBlock } from './assistant-markdown';

function paragraph(text: string): MdBlock {
  return { t: 'p', c: [{ t: 'text', v: text }] };
}

describe('parseAssistantMarkdown', () => {
  it('renders headings, emphasis, code, and lists', () => {
    const blocks = parseAssistantMarkdown(
      ['## 要点', '', '这是 **加粗** 和 *斜体*，以及 `code`。', '', '- 第一项', '- 第二项', '', '1. 先做', '2. 再做'].join(
        '\n',
      ),
    );
    expect(blocks[0]).toEqual({ t: 'h', level: 2, c: [{ t: 'text', v: '要点' }] });
    expect(blocks[1]).toMatchObject({
      t: 'p',
      c: [
        { t: 'text', v: '这是 ' },
        { t: 'strong', c: [{ t: 'text', v: '加粗' }] },
        { t: 'text', v: ' 和 ' },
        { t: 'em', c: [{ t: 'text', v: '斜体' }] },
        { t: 'text', v: '，以及 ' },
        { t: 'code', v: 'code' },
        { t: 'text', v: '。' },
      ],
    });
    expect(blocks[2]).toMatchObject({
      t: 'ul',
      items: [{ checked: null, c: [paragraph('第一项')] }, { checked: null, c: [paragraph('第二项')] }],
    });
    expect(blocks[3]).toMatchObject({ t: 'ol', start: 1, items: [{ c: [paragraph('先做')] }, { c: [paragraph('再做')] }] });
  });

  it('keeps an unclosed marker literal and keeps single line breaks', () => {
    const blocks = parseAssistantMarkdown('还没写完 **加粗\n下一行');
    expect(blocks).toEqual([
      {
        t: 'p',
        c: [
          { t: 'text', v: '还没写完 **加粗' },
          { t: 'br' },
          { t: 'text', v: '下一行' },
        ],
      },
    ]);
  });

  it('reads fenced code, quotes, rules, and task items', () => {
    const blocks = parseAssistantMarkdown(
      ['> 引用 **一句**', '', '---', '', '- [x] 已做', '- [ ] 待做', '', '```ts', 'const n = 1;', '```'].join('\n'),
    );
    expect(blocks[0]).toMatchObject({ t: 'quote' });
    const quote = blocks[0];
    if (quote?.t !== 'quote') throw new Error('quote');
    expect(quote.c[0]).toMatchObject({ t: 'p', c: [{ t: 'text', v: '引用 ' }, { t: 'strong' }] });
    expect(blocks[1]).toEqual({ t: 'hr' });
    expect(blocks[2]).toMatchObject({
      t: 'ul',
      items: [
        { checked: true, c: [paragraph('已做')] },
        { checked: false, c: [paragraph('待做')] },
      ],
    });
    expect(blocks[3]).toEqual({ t: 'code', lang: 'ts', v: 'const n = 1;' });
  });

  it('reads a table without turning raw html into structure', () => {
    const blocks = parseAssistantMarkdown(['| 名 | 值 |', '| --- | ---: |', '| **甲** | 1 |', '', '<script>alert(1)</script>'].join('\n'));
    expect(blocks[0]).toMatchObject({
      t: 'table',
      align: ['', 'right'],
      head: [[{ t: 'text', v: '名' }], [{ t: 'text', v: '值' }]],
    });
    const table = blocks[0];
    if (table?.t !== 'table') throw new Error('table');
    expect(table.rows[0]?.[0]).toEqual([{ t: 'strong', c: [{ t: 'text', v: '甲' }] }]);
    expect(blocks[1]).toEqual(paragraph('<script>alert(1)</script>'));
  });

  it('nests a list under its parent item', () => {
    const blocks = parseAssistantMarkdown('- 外\n  - 内');
    expect(blocks[0]).toMatchObject({
      t: 'ul',
      items: [
        {
          c: [paragraph('外'), { t: 'ul', items: [{ c: [paragraph('内')] }] }],
        },
      ],
    });
  });
});

describe('safe links', () => {
  it('allows http(s), mailto, and site paths', () => {
    expect(safeHref('https://example.com/a')).toBe('https://example.com/a');
    expect(safeHref('mailto:a@b.c')).toBe('mailto:a@b.c');
    expect(safeHref('/docs?doc=1')).toBe('/docs?doc=1');
    expect(safeHref('javascript:alert(1)')).toBeNull();
    expect(safeHref('//evil.example')).toBeNull();
    expect(safeImageSrc('https://cdn.example/a.png')).toBe('https://cdn.example/a.png');
    expect(safeImageSrc('javascript:alert(1)')).toBeNull();
  });
});

