// @vitest-environment happy-dom
import { Editor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import TextAlign from '@tiptap/extension-text-align';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { PaperToolbar } from './paper-toolbar';

vi.mock('./selection-toolbar', () => ({ SelectionActions: () => null }));

let editor: Editor;
let root: Root;
let host: HTMLDivElement;

beforeEach(async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  host = document.createElement('div');
  document.body.append(host);
  editor = new Editor({
    extensions: [StarterKit, TextAlign.configure({ types: ['heading', 'paragraph'] })],
    content: '<h1 style="text-align:center">One</h1><h2 style="text-align:right">Two</h2><p>Body</p>',
  });
  root = createRoot(host);
  await act(async () => {
    root.render(<PaperToolbar editor={editor} canInsertMedia={false}
      onInsertLink={() => {}} onPickImage={() => {}} onPickVideo={() => {}}
      onToggleTable={() => {}} onInsertMath={() => {}} onFind={() => {}} findOpen={false} />);
  });
});

afterEach(async () => {
  await act(async () => root.unmount());
  editor.destroy();
  host.remove();
});

function trigger(label: string): HTMLButtonElement {
  const button = host.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`);
  expect(button).not.toBeNull();
  return button!;
}

it('shows the current heading and alignment as the caret moves without editing', async () => {
  const original = editor.getJSON();
  for (const [pos, heading, alignment] of [
    [1, 'H1', '居中'], [6, 'H2', '居右'], [11, '正文', '居左'], [1, 'H1', '居中'],
  ] as const) {
    await act(async () => { editor.commands.setTextSelection(pos); });
    expect(trigger('标题').textContent).toBe(heading);
    expect(trigger('对齐').textContent).toBe(alignment);
    expect(trigger('标题').getAttribute('aria-haspopup')).toBe('listbox');
  }
  expect(editor.getJSON()).toEqual(original);
  expect(host.querySelector('select')).toBeNull();
});

it('applies custom menu choices to the selected block and reflects undo', async () => {
  await act(async () => { editor.commands.setTextSelection(6); });
  for (const [label, choice] of [['标题', 'H1'], ['对齐', '居中']]) {
    await act(async () => trigger(label!).click());
    const option = Array.from(document.querySelectorAll<HTMLButtonElement>('[role="option"]'))
      .find((item) => item.textContent === choice);
    expect(option).toBeDefined();
    await act(async () => option!.click());
    expect(trigger(label!).textContent).toBe(choice);
  }
  expect(editor.state.doc.child(1).attrs).toMatchObject({ level: 1, textAlign: 'center' });
  expect(editor.state.doc.child(0).attrs).toMatchObject({ level: 1, textAlign: 'center' });
  await act(async () => { editor.commands.undo(); });
  expect(trigger('标题').textContent).toBe('H2');
  expect(trigger('对齐').textContent).toBe('居右');
});
