// @vitest-environment happy-dom
import { DocTableCell, DocTableHeader } from '@inwit/doc-schema';
import { Table, TableRow } from '@tiptap/extension-table';
import { Editor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { TableContextMenu } from './table-menu';
import { tableKeys } from './table-keys';

let editor: Editor;
let root: Root;
let host: HTMLDivElement;

beforeEach(async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  host = document.createElement('div');
  document.body.append(host);
  editor = new Editor({
    extensions: [
      StarterKit,
      Table.configure({ resizable: false }),
      TableRow,
      DocTableHeader,
      DocTableCell,
      tableKeys,
    ],
    content: '<p>正文</p>',
  });
  root = createRoot(host);
  await act(async () => {
    root.render(<TableContextMenu editor={editor} />);
  });
});

afterEach(async () => {
  await act(async () => root.unmount());
  editor.destroy();
  host.remove();
});

function cols(): number {
  let count = 0;
  let seen = false;
  editor.state.doc.descendants((node) => {
    if (seen || node.type.name !== 'tableRow') return;
    seen = true;
    node.forEach((cell) => {
      count += typeof cell.attrs.colspan === 'number' ? cell.attrs.colspan : 1;
    });
    return false;
  });
  return count;
}

it('opens a table menu on a cell and adds a column from it', async () => {
  const paragraph = editor.view.dom.querySelector('p');
  paragraph?.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }));
  expect(document.querySelector('[aria-label="表格菜单"]')).toBeNull();

  await act(async () => {
    editor.commands.insertTable({ rows: 3, cols: 3, withHeaderRow: true });
  });
  const cell = editor.view.dom.querySelector('td');
  expect(cell).not.toBeNull();
  await act(async () => {
    cell?.dispatchEvent(
      new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 24, clientY: 24 }),
    );
  });
  const menu = document.querySelector('[aria-label="表格菜单"]');
  expect(menu).not.toBeNull();
  expect(menu?.querySelector('.paper-table-menu-key')?.textContent).toMatch(/↑/);
  const add = menu?.querySelector<HTMLButtonElement>('button[aria-label="右侧加列"]');
  expect(add).not.toBeNull();
  await act(async () => {
    add?.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
    add?.click();
  });
  expect(cols()).toBe(4);
  expect(document.querySelector('[aria-label="表格菜单"]')).toBeNull();
});
