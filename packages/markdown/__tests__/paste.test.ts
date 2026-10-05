import { describe, expect, it } from 'vitest';
import { htmlClipboardIsRich, markdownPasteBlocks } from '../src/paste.js';
import type { PmNode } from '../src/types.js';

const TASK =
  '11111111-1111-4111-8111-111111111111';

function textOf(node: PmNode | undefined): string {
  if (!node) return '';
  if (node.text) return node.text;
  return (node.content ?? []).map((child) => textOf(child)).join('');
}

describe('markdownPasteBlocks', () => {
  it('leaves ordinary prose and prices alone', () => {
    expect(markdownPasteBlocks('今天复习间隔重复。')).toBeNull();
    expect(markdownPasteBlocks('第一行\n第二行')).toBeNull();
    expect(markdownPasteBlocks('售价 $100。')).toBeNull();
    expect(markdownPasteBlocks('file_name_here')).toBeNull();
    expect(markdownPasteBlocks('2*3*4')).toBeNull();
    expect(markdownPasteBlocks('   \n')).toBeNull();
  });

  it('turns inline markdown into marks without joining separate lines', () => {
    const blocks = markdownPasteBlocks('今天 **重点**\n明天继续');
    expect(blocks).toMatchObject([
      {
        type: 'paragraph',
        content: [
          { type: 'text', text: '今天 ' },
          { type: 'text', text: '重点', marks: [{ type: 'bold' }] },
        ],
      },
      { type: 'paragraph', content: [{ type: 'text', text: '明天继续' }] },
    ]);
  });

  it('turns a single inline span into marks', () => {
    expect(markdownPasteBlocks('这是*强调*的')).toMatchObject([
      {
        type: 'paragraph',
        content: [
          { type: 'text', text: '这是' },
          { type: 'text', text: '强调', marks: [{ type: 'italic' }] },
          { type: 'text', text: '的' },
        ],
      },
    ]);
    expect(markdownPasteBlocks('见 [文档](https://example.com)')).toMatchObject([
      {
        content: [
          { type: 'text', text: '见 ' },
          { type: 'text', text: '文档', marks: [{ type: 'link', attrs: { href: 'https://example.com' } }] },
        ],
      },
    ]);
    expect(markdownPasteBlocks('运行 `pnpm test`')).toMatchObject([
      { content: [{ text: '运行 ' }, { text: 'pnpm test', marks: [{ type: 'code' }] }] },
    ]);
    expect(markdownPasteBlocks('能量 $E=mc^2$')).toMatchObject([
      { content: [{ type: 'text', text: '能量 ' }, { type: 'inlineMath', attrs: { latex: 'E=mc^2' } }] },
    ]);
  });

  it('parses a markdown document and joins a soft wrap', () => {
    const blocks = markdownPasteBlocks('# 标题\n\n正文 **粗**\n还在同一段。\n\n- 一\n- **二**');
    expect(blocks?.[0]).toMatchObject({ type: 'heading', attrs: { level: 1 } });
    expect(textOf(blocks?.[1])).toBe('正文 粗 还在同一段。');
    expect(blocks?.[1]?.content?.some((node) => node.marks?.[0]?.type === 'bold')).toBe(true);
    expect(blocks?.[2]?.type).toBe('bulletList');
    expect(blocks?.some((node) => node.type === 'pageBreak' || node.type === 'horizontalRule')).toBe(false);
  });

  it('keeps a thematic break as a horizontal rule', () => {
    expect(markdownPasteBlocks('---')).toEqual([{ type: 'horizontalRule' }]);
  });

  it('parses lists, tasks, fences, tables, quotes, and video', () => {
    expect(markdownPasteBlocks('- [ ] 待办\n- [x] 完成')?.[0]?.type).toBe('taskList');
    const code = markdownPasteBlocks('```ts\nconst x = 1\nconst y = 2\n```');
    expect(code).toMatchObject([
      { type: 'codeBlock', attrs: { language: 'ts' }, content: [{ type: 'text', text: 'const x = 1\nconst y = 2' }] },
    ]);
    expect(markdownPasteBlocks('| a | b |\n| --- | --- |\n| 1 | 2 |')?.[0]?.type).toBe('table');
    const quote = markdownPasteBlocks('> 引用\n> 第二行');
    expect(quote?.[0]?.type).toBe('blockquote');
    expect(textOf(quote?.[0])).toBe('引用 第二行');
    expect(markdownPasteBlocks('::video{src="https://example.com/a.mp4"}')).toMatchObject([
      { type: 'video', attrs: { src: 'https://example.com/a.mp4' } },
    ]);
    expect(markdownPasteBlocks(`[[task:${TASK}]]`)).toMatchObject([
      { content: [{ type: 'vitalEntity', attrs: { kind: 'task', id: TASK } }] },
    ]);
  });

  it('keeps rendered HTML and converts a source wrapper', () => {
    expect(htmlClipboardIsRich('<p><strong>粗</strong></p>')).toBe(true);
    expect(htmlClipboardIsRich('<div><span style="color:#000"># 标题</span></div>')).toBe(false);
    expect(markdownPasteBlocks('粗', '<p><strong>粗</strong></p>')).toBeNull();
    expect(markdownPasteBlocks('# 标题\n\n- 一项', '<ul><li>一项</li></ul>')).toBeNull();
    expect(markdownPasteBlocks('# 标题', '<pre># 标题</pre>')?.[0]?.type).toBe('heading');
    expect(markdownPasteBlocks('', '<div><span># 标题</span></div>')?.[0]).toMatchObject({
      type: 'heading',
      attrs: { level: 1 },
    });
  });
});
