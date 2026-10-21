import { serializePmJSONToMarkdown } from '@inwit/markdown';
import { EditorState, NodeSelection } from '@tiptap/pm/state';
import { Node } from 'prosemirror-model';
import { describe, expect, it } from 'vitest';
import { applyEntityAnchor, getHeadlessSchema, pmJsonToText, type PmJson } from '../src/index.js';
import {
  codeBlockCollapsedAttribute,
  codeBlockCollapsedOf,
  codeBlockFoldLabel,
  collapsedCodeTypingTransaction,
} from '../src/schema/code-block.js';

describe('code block fold', () => {
  it('labels a folded block with its first line and the line count', () => {
    expect(codeBlockFoldLabel('')).toBe('空代码');
    expect(codeBlockFoldLabel('const x = 1')).toBe('const x = 1');
    expect(codeBlockFoldLabel('const x = 1\nconst y = 2')).toBe('const x = 1 · 2 行');
    expect(codeBlockFoldLabel('\n\nonly')).toBe('only · 3 行');
    expect(codeBlockFoldLabel('   \n\n')).toBe('3 行');
  });

  it('reads only an explicit collapsed flag', () => {
    expect(codeBlockCollapsedOf(true)).toBe(true);
    expect(codeBlockCollapsedOf('true')).toBe(true);
    expect(codeBlockCollapsedOf(false)).toBe(false);
    expect(codeBlockCollapsedOf(undefined)).toBe(false);
    expect(codeBlockCollapsedOf('false')).toBe(false);
  });

  it('renders the flag on the element and parses it back', () => {
    const attr = codeBlockCollapsedAttribute();
    expect(attr.renderHTML?.({ collapsed: true })).toEqual({ 'data-collapsed': 'true' });
    expect(attr.renderHTML?.({ collapsed: false })).toEqual({});
    const element = { getAttribute: (name: string) => (name === 'data-collapsed' ? 'true' : null) };
    expect(attr.parseHTML?.(element as HTMLElement)).toBe(true);
  });

  it('keeps collapsed on the node and still exports the source', () => {
    const schema = getHeadlessSchema();
    const type = schema.nodes.codeBlock;
    if (!type) throw new Error('missing codeBlock');
    const open = type.create({ language: 'ts' }, schema.text('const x = 1'));
    expect(open.attrs.collapsed).toBe(false);
    expect(open.toJSON().attrs).toMatchObject({ language: 'ts', collapsed: false });

    const folded = type.create({ language: 'ts', collapsed: true }, schema.text('const x = 1\nconst y = 2'));
    expect(folded.toJSON().attrs).toEqual({ language: 'ts', collapsed: true });
    const again = schema.nodeFromJSON(folded.toJSON());
    expect(again.attrs.collapsed).toBe(true);
    expect(again.textContent).toBe('const x = 1\nconst y = 2');

    const legacy = schema.nodeFromJSON({
      type: 'codeBlock',
      attrs: { language: 'python' },
      content: [{ type: 'text', text: 'print(1)' }],
    });
    expect(legacy.attrs.collapsed).toBe(false);
    expect(legacy.attrs.language).toBe('python');

    const doc: PmJson = { type: 'doc', content: [folded.toJSON() as PmJson] };
    expect(pmJsonToText(doc)).toContain('const y = 2');
    const markdown = serializePmJSONToMarkdown(doc);
    expect(markdown).toContain('```ts');
    expect(markdown).toContain('const x = 1');
    expect(markdown).toContain('const y = 2');
    expect(markdown).not.toContain('collapsed');
  });

  it('survives a headless anchor rewrite', () => {
    const source: PmJson = {
      type: 'doc',
      content: [
        { type: 'paragraph', content: [{ type: 'text', text: '前文' }] },
        {
          type: 'codeBlock',
          attrs: { language: 'ts', collapsed: true },
          content: [{ type: 'text', text: 'const x = 1' }],
        },
      ],
    };
    const next = applyEntityAnchor(source, 'annotation', 'n1', { from: 1, to: 3 });
    const code = next.content?.[1];
    expect(code?.type).toBe('codeBlock');
    expect(code?.attrs?.collapsed).toBe(true);
    expect(code?.attrs?.language).toBe('ts');
    expect(Node.fromJSON(getHeadlessSchema(), next).textContent).toContain('const x = 1');
  });

  it('inserts into a selected collapsed block instead of replacing it', () => {
    const schema = getHeadlessSchema();
    const code = schema.nodes.codeBlock!.create(
      { language: 'ts', collapsed: true },
      schema.text('const x = 1'),
    );
    const doc = schema.nodes.doc!.create(null, [code]);
    const state = EditorState.create({ schema, doc, selection: NodeSelection.create(doc, 0) });
    const tr = collapsedCodeTypingTransaction(state, { kind: 'insert', text: 'x' });
    expect(tr).not.toBeNull();
    const next = state.apply(tr!);
    expect(next.doc.firstChild?.type.name).toBe('codeBlock');
    expect(next.doc.firstChild?.attrs.collapsed).toBe(false);
    expect(next.doc.firstChild?.textContent).toBe('xconst x = 1');
    expect(next.selection.from).toBe(2);
    expect(next.selection.empty).toBe(true);
  });

  it('expands a selected collapsed block without deleting its source', () => {
    const schema = getHeadlessSchema();
    const code = schema.nodes.codeBlock!.create(
      { language: null, collapsed: true },
      schema.text('plain'),
    );
    const doc = schema.nodes.doc!.create(null, [code]);
    const state = EditorState.create({ schema, doc, selection: NodeSelection.create(doc, 0) });
    const tr = collapsedCodeTypingTransaction(state, { kind: 'expand', edge: 'start' });
    expect(tr).not.toBeNull();
    const next = state.apply(tr!);
    expect(next.doc.firstChild?.textContent).toBe('plain');
    expect(next.doc.firstChild?.attrs.collapsed).toBe(false);
    expect(next.doc.firstChild?.attrs.language).toBeNull();
    expect(next.selection.from).toBe(1);
  });

  it('ignores typing when the collapsed block is not selected as a whole', () => {
    const schema = getHeadlessSchema();
    const doc = schema.nodes.doc!.create(null, [
      schema.nodes.paragraph!.create(null, schema.text('前文')),
    ]);
    const state = EditorState.create({ schema, doc });
    expect(collapsedCodeTypingTransaction(state, { kind: 'insert', text: 'x' })).toBeNull();
  });
});
