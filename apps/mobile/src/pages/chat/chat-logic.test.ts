import { describe, expect, it } from 'vitest';
import {
  capDocumentMentions,
  conversationActionLine,
  dirtyDocumentIds,
  messageBodyKind,
  parseChatMarkdown,
  pendingStatusLine,
  safeHref,
  safeImageSrc,
} from './chat-logic';

const DOC = '11111111-1111-4111-8111-111111111111';
const OTHER = '22222222-2222-4222-8222-222222222222';

describe('capDocumentMentions', () => {
  it('keeps the first five unique ids', () => {
    const ids = ['a', 'b', 'a', '', 'c', 'd', 'e', 'f'];
    expect(capDocumentMentions(ids)).toEqual(['a', 'b', 'c', 'd', 'e']);
  });
});

describe('dirtyDocumentIds', () => {
  it('includes the open document only while its body is dirty', () => {
    expect(dirtyDocumentIds(DOC, true)).toEqual([DOC]);
    expect(dirtyDocumentIds(DOC, false)).toEqual([]);
    expect(dirtyDocumentIds(null, true)).toEqual([]);
  });
});

describe('conversationActionLine', () => {
  it('matches update, create, and card wording, including the unsaved draft', () => {
    expect(
      conversationActionLine(
        { type: 'update_document', documentId: DOC, title: '笔记', status: 'applied' },
        null,
      ).text,
    ).toBe('已更新《笔记》');
    expect(
      conversationActionLine(
        { type: 'update_document', documentId: DOC, title: '笔记', status: 'applied' },
        DOC,
      ).text,
    ).toBe('《笔记》已写入，但这边还有未保存的修改，正文仍是你的草稿');
    expect(
      conversationActionLine(
        { type: 'update_document', documentId: DOC, title: '笔记', status: 'blocked_dirty' },
        null,
      ).text,
    ).toBe('《笔记》有未保存的修改，这次没有写入');
    expect(
      conversationActionLine(
        {
          type: 'update_document',
          documentId: DOC,
          title: '笔记',
          status: 'rejected',
          reason: '太长',
        },
        null,
      ).text,
    ).toBe('没能修改《笔记》：太长');
    expect(
      conversationActionLine({ type: 'create_document', documentId: OTHER, title: '新页' }, null),
    ).toEqual({ text: '已新建《新页》', documentId: OTHER });
    expect(
      conversationActionLine(
        { type: 'write_cards', documentId: DOC, title: '笔记', count: 3 },
        null,
      ).text,
    ).toBe('已写入 3 张卡片到《笔记》');
    expect(
      conversationActionLine(
        {
          type: 'update_mind_node',
          documentId: DOC,
          nodeId: OTHER,
          title: '梯度',
          status: 'rejected',
          reason: '找不到这个节点',
        },
        null,
      ).text,
    ).toBe('没能修改节点「梯度」：找不到这个节点');
  });
});

describe('message presentation', () => {
  it('keeps user text plain and names the pending line', () => {
    expect(messageBodyKind('user')).toBe('plain');
    expect(messageBodyKind('assistant')).toBe('markdown');
    expect(pendingStatusLine('正在阅读文档')).toBe('正在阅读文档');
    expect(pendingStatusLine('  ')).toBe('正在处理…');
    expect(pendingStatusLine(null)).toBe('正在处理…');
  });
});

describe('parseChatMarkdown', () => {
  it('parses the shared subset and leaves raw HTML as text', () => {
    const blocks = parseChatMarkdown(
      [
        '# 标题',
        '',
        '这是 *斜体* 和 **粗体** 以及 ~~删除~~。',
        '',
        '- 一',
        '- 二',
        '',
        '1. 先',
        '',
        '```ts',
        'const n = 1',
        '```',
        '',
        '| 名 | 值 |',
        '| --- | ---: |',
        '| a | 1 |',
        '',
        '[站](https://example.com/a) 和 [信](mailto:a@b.co)',
        '',
        '![图](https://example.com/a.png)',
        '',
        '<script>alert(1)</script>',
      ].join('\n'),
    );

    expect(blocks[0]).toEqual({ t: 'h', level: 1, c: [{ t: 'text', v: '标题' }] });
    const para = blocks[1];
    expect(para?.t).toBe('p');
    if (para?.t === 'p') {
      expect(para.c).toEqual([
        { t: 'text', v: '这是 ' },
        { t: 'em', c: [{ t: 'text', v: '斜体' }] },
        { t: 'text', v: ' 和 ' },
        { t: 'strong', c: [{ t: 'text', v: '粗体' }] },
        { t: 'text', v: ' 以及 ' },
        { t: 'del', c: [{ t: 'text', v: '删除' }] },
        { t: 'text', v: '。' },
      ]);
    }
    expect(blocks[2]).toMatchObject({ t: 'ul' });
    expect(blocks[3]).toMatchObject({ t: 'ol', start: 1 });
    expect(blocks[4]).toEqual({ t: 'code', lang: 'ts', v: 'const n = 1' });
    const table = blocks[5];
    expect(table?.t).toBe('table');
    if (table?.t === 'table') {
      expect(table.align[1]).toBe('right');
      expect(table.rows).toHaveLength(1);
    }
    const links = blocks[6];
    expect(links?.t).toBe('p');
    if (links?.t === 'p') {
      const hrefs = links.c.flatMap((node) => (node.t === 'link' ? [node.href] : []));
      expect(hrefs).toEqual(['https://example.com/a', 'mailto:a@b.co']);
    }
    const image = blocks[7];
    expect(image?.t).toBe('p');
    if (image?.t === 'p') {
      expect(image.c).toEqual([{ t: 'image', alt: '图', src: 'https://example.com/a.png' }]);
    }
    const html = blocks[8];
    expect(html).toEqual({ t: 'p', c: [{ t: 'text', v: '<script>alert(1)</script>' }] });
  });

  it('only allows http(s), mailto, and same-app links', () => {
    expect(safeHref('https://example.com/a')).toBe('https://example.com/a');
    expect(safeHref('mailto:a@b.co')).toBe('mailto:a@b.co');
    expect(safeHref('/docs/abc')).toBe('/docs/abc');
    expect(safeHref('javascript:alert(1)')).toBeNull();
    expect(safeHref('//evil.test')).toBeNull();
    expect(safeImageSrc('https://example.com/a.png')).toBe('https://example.com/a.png');
    expect(safeImageSrc('javascript:alert(1)')).toBeNull();
    expect(safeImageSrc('/local.png')).toBeNull();
  });
});
