import type { Attribute } from '@tiptap/core';
import CodeBlock from '@tiptap/extension-code-block';
import { NodeSelection, Plugin, TextSelection, type EditorState, type Transaction } from '@tiptap/pm/state';

/** Transaction meta for a code-block fold toggle. Read mode saves only these. */
export const CODE_FOLD_META = 'codeFold';

/** Stored fold flag. Missing and unknown values stay expanded. */
export function codeBlockCollapsedOf(value: unknown): boolean {
  return value === true || value === 'true';
}

/**
 * One-line label for a folded block. The first non-empty line stays visible,
 * and a longer block adds its line count.
 */
export function codeBlockFoldLabel(text: string): string {
  if (text.length === 0) return '空代码';
  const lines = text.split('\n');
  const preview = lines.map((line) => line.trim()).find((line) => line.length > 0) ?? '';
  if (lines.length <= 1) return preview || '空代码';
  if (preview === '') return `${lines.length} 行`;
  return `${preview} · ${lines.length} 行`;
}

export function codeBlockCollapsedAttribute(): Attribute {
  return {
    default: false,
    parseHTML: (element) => element.getAttribute('data-collapsed') === 'true',
    renderHTML: (attributes) =>
      codeBlockCollapsedOf(attributes.collapsed) ? { 'data-collapsed': 'true' } : {},
  };
}

/**
 * A collapsed code block selected as a whole must not be replaced by the next
 * key. Insert at the start and expand, or only expand and place the caret.
 */
export function collapsedCodeTypingTransaction(
  state: EditorState,
  action: { kind: 'insert'; text: string } | { kind: 'expand'; edge: 'start' | 'end' },
): Transaction | null {
  const selection = state.selection;
  if (!(selection instanceof NodeSelection)) return null;
  if (selection.node.type.name !== 'codeBlock') return null;
  if (!codeBlockCollapsedOf(selection.node.attrs.collapsed)) return null;
  const pos = selection.from;
  let tr = state.tr;
  let caret = pos + 1;
  if (action.kind === 'insert') {
    if (action.text.length === 0) return null;
    tr = tr.insertText(action.text, caret);
    caret += action.text.length;
  } else if (action.edge === 'end') {
    const block = tr.doc.nodeAt(pos);
    if (!block) return null;
    caret = pos + block.nodeSize - 1;
  }
  const block = tr.doc.nodeAt(pos);
  if (!block || block.type.name !== 'codeBlock') return null;
  tr = tr.setNodeMarkup(pos, null, { ...block.attrs, collapsed: false });
  tr.setMeta(CODE_FOLD_META, true);
  tr.setSelection(TextSelection.create(tr.doc, caret));
  return tr;
}

/** Keeps typing, Backspace, Delete, and paste from replacing a folded code block. */
export function codeFoldTypingPlugin(): Plugin {
  return new Plugin({
    props: {
      handleTextInput(view, _from, _to, text) {
        const tr = collapsedCodeTypingTransaction(view.state, { kind: 'insert', text });
        if (!tr) return false;
        view.dispatch(tr);
        return true;
      },
      handleKeyDown(view, event) {
        if (event.key !== 'Backspace' && event.key !== 'Delete') return false;
        const tr = collapsedCodeTypingTransaction(view.state, {
          kind: 'expand',
          edge: event.key === 'Delete' ? 'end' : 'start',
        });
        if (!tr) return false;
        view.dispatch(tr);
        return true;
      },
      handlePaste(view) {
        const tr = collapsedCodeTypingTransaction(view.state, { kind: 'expand', edge: 'end' });
        if (!tr) return false;
        view.dispatch(tr);
        return false;
      },
    },
  });
}

/** Headless code block. Editors add highlighting and the fold button on top. */
export const FoldableCodeBlock = CodeBlock.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      collapsed: codeBlockCollapsedAttribute(),
    };
  },
  addProseMirrorPlugins() {
    return [...(this.parent?.() ?? []), codeFoldTypingPlugin()];
  },
});
