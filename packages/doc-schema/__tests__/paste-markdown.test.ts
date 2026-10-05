import { EditorState, TextSelection } from '@tiptap/pm/state';
import { describe, expect, it } from 'vitest';
import { dispatchMarkdownPaste, markdownPasteTransaction } from '../src/paste-markdown.js';
import { getHeadlessSchema } from '../src/schema/headless.js';

function editor(json: unknown, pos?: number): EditorState {
  const schema = getHeadlessSchema();
  const doc = schema.nodeFromJSON(json);
  const selection = TextSelection.create(doc, pos ?? 1);
  return EditorState.create({ schema, doc, selection });
}

function clipboard(data: Record<string, string>) {
  return {
    getData(type: string) {
      if (type in data) return data[type] ?? '';
      if (type === 'text/x-unknown') throw new Error('unsupported');
      return '';
    },
  };
}

function pasted(state: EditorState, plain: string, html = ''): EditorState | null {
  let next: EditorState | null = null;
  const ok = dispatchMarkdownPaste(
    {
      state,
      dispatch(tr) {
        next = state.apply(tr);
      },
    },
    clipboard({ 'text/plain': plain, 'text/html': html }),
  );
  return ok ? next : null;
}

function types(state: EditorState): string[] {
  const names: string[] = [];
  state.doc.descendants((node) => {
    if (node.isText) return;
    names.push(node.type.name);
  });
  return names;
}

describe('markdownPasteTransaction', () => {
  it('merges inline markdown into the current paragraph', () => {
    const start = editor(
      { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'hello' }] }] },
      3,
    );
    const next = pasted(start, '**粗**');
    expect(next?.doc.textContent).toBe('he粗llo');
    expect(next?.doc.toJSON()).toMatchObject({
      content: [
        {
          type: 'paragraph',
          content: [
            { type: 'text', text: 'he' },
            { type: 'text', text: '粗', marks: [{ type: 'bold' }] },
            { type: 'text', text: 'llo' },
          ],
        },
      ],
    });
    expect(next?.selection.empty).toBe(true);
    expect(next?.selection.from).toBe(4);
  });

  it('replaces an empty paragraph with a markdown document', () => {
    const start = editor({ type: 'doc', content: [{ type: 'paragraph' }] });
    const next = pasted(start, '# 标题\n\n正文');
    expect(types(next!)).toEqual(['heading', 'paragraph']);
    expect(next?.doc.textContent).toBe('标题正文');
    expect(next?.doc.child(0).type.name).toBe('heading');
  });

  it('joins pasted paragraphs with the text around the cursor', () => {
    const start = editor(
      { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'hello' }] }] },
      3,
    );
    expect(pasted(start, '甲\n\n乙')).toBeNull();
    const next = pasted(start, '**甲**\n\n乙');
    expect(next?.doc.childCount).toBe(2);
    expect(next?.doc.child(0).textContent).toBe('he甲');
    let bold = '';
    next?.doc.child(0).descendants((node) => {
      if (node.marks.some((mark) => mark.type.name === 'bold')) bold = node.text ?? '';
    });
    expect(bold).toBe('甲');
    expect(next?.doc.child(1).textContent).toBe('乙llo');
  });

  it('inserts a heading into the middle of a paragraph', () => {
    const start = editor(
      { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'hello' }] }] },
      3,
    );
    const next = pasted(start, '# 标题');
    expect(types(next!)).toEqual(['paragraph', 'heading', 'paragraph']);
    expect(next?.doc.child(0).textContent).toBe('he');
    expect(next?.doc.child(1).textContent).toBe('标题');
    expect(next?.doc.child(2).textContent).toBe('llo');
  });

  it('inserts a list and a horizontal rule', () => {
    const start = editor({ type: 'doc', content: [{ type: 'paragraph' }] });
    const list = pasted(start, '- 一\n- 二');
    expect(list?.doc.child(0).type.name).toBe('bulletList');
    expect(list?.doc.textContent).toBe('一二');

    const rule = pasted(start, '---');
    expect(rule?.doc.child(0).type.name).toBe('horizontalRule');
  });

  it('does not convert inside a code block or inline code', () => {
    const block = editor({
      type: 'doc',
      content: [{ type: 'codeBlock', content: [{ type: 'text', text: 'const x = 1' }] }],
    }, 2);
    expect(pasted(block, '# 标题')).toBeNull();

    const inline = editor({
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [{ type: 'text', text: 'code', marks: [{ type: 'code' }] }],
        },
      ],
    }, 2);
    expect(pasted(inline, '**粗**')).toBeNull();
  });

  it('prefers text/markdown and ignores rich HTML', () => {
    const start = editor({ type: 'doc', content: [{ type: 'paragraph' }] });
    const applied: { state: EditorState | null } = { state: null };
    const ok = dispatchMarkdownPaste(
      {
        state: start,
        dispatch(tr) {
          applied.state = start.apply(tr);
        },
      },
      clipboard({
        'text/plain': '不是 markdown',
        'text/markdown': '# 标题',
      }),
    );
    expect(ok).toBe(true);
    expect(applied.state?.doc.child(0).type.name).toBe('heading');
    expect(pasted(start, '# 标题', '<h1>标题</h1>')).toBeNull();
  });

  it('returns null when the schema cannot hold the slice', () => {
    const start = editor({ type: 'doc', content: [{ type: 'paragraph' }] });
    expect(markdownPasteTransaction(start, '普通句子')).toBeNull();
  });
});
