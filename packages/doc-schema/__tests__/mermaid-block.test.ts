import type { Node as ProseMirrorNode } from '@tiptap/pm/model';
import { EditorState, TextSelection } from '@tiptap/pm/state';
import { describe, expect, it } from 'vitest';
import { getHeadlessSchema } from '../src/schema/headless.js';
import { mermaidViewOf, replaceMermaidCodeBlocks } from '../src/schema/mermaid-block.js';

function nodeType(name: string) {
  const type = getHeadlessSchema().nodes[name];
  if (!type) throw new Error(`missing node ${name}`);
  return type;
}

function codeBlock(language: string, text: string): ProseMirrorNode {
  const schema = getHeadlessSchema();
  return nodeType('codeBlock').create({ language }, text === '' ? null : schema.text(text));
}

function docWith(...nodes: ProseMirrorNode[]): ProseMirrorNode {
  return nodeType('doc').create(null, nodes);
}

describe('mermaidViewOf', () => {
  it('keeps the three modes and falls back to render', () => {
    expect(mermaidViewOf('code')).toBe('code');
    expect(mermaidViewOf('split')).toBe('split');
    expect(mermaidViewOf('render')).toBe('render');
    expect(mermaidViewOf('side')).toBe('render');
    expect(mermaidViewOf(null)).toBe('render');
  });
});

describe('replaceMermaidCodeBlocks', () => {
  it('turns mermaid and mmd code blocks into render blocks and leaves other code', () => {
    const schema = getHeadlessSchema();
    const doc = docWith(
      codeBlock('mmd', 'graph TD\n  A-->B'),
      codeBlock('ts', 'const x = 1'),
      nodeType('paragraph').create(),
    );
    let state = EditorState.create({ schema, doc });
    state = state.apply(
      state.tr.setSelection(TextSelection.create(state.doc, state.doc.content.size - 1)),
    );
    const tr = replaceMermaidCodeBlocks(state, true);
    expect(tr).not.toBeNull();
    const next = state.apply(tr!);
    expect(next.doc.child(0).type.name).toBe('mermaid');
    expect(next.doc.child(0).attrs.view).toBe('render');
    expect(next.doc.child(0).textContent).toBe('graph TD\n  A-->B');
    expect(next.doc.child(1).type.name).toBe('codeBlock');
    expect(next.doc.child(1).attrs.language).toBe('ts');
    expect(replaceMermaidCodeBlocks(next, true)).toBeNull();
  });

  it('uses split when the caret is inside the block and the edit is not a quiet load', () => {
    const schema = getHeadlessSchema();
    const doc = docWith(codeBlock('mermaid', 'graph LR\n  A-->B'));
    let state = EditorState.create({ schema, doc });
    state = state.apply(state.tr.setSelection(TextSelection.create(state.doc, 1)));
    const tr = replaceMermaidCodeBlocks(state, true);
    expect(state.apply(tr!).doc.child(0).attrs.view).toBe('split');
    const quiet = replaceMermaidCodeBlocks(state, false);
    expect(state.apply(quiet!).doc.child(0).attrs.view).toBe('render');
  });
});
