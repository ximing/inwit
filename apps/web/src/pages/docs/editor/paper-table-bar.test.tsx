// @vitest-environment happy-dom
import { DocTableCell, DocTableHeader } from '@inwit/doc-schema';
import { Table, TableRow } from '@tiptap/extension-table';
import { Editor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { PaperToolbar } from './paper-toolbar';

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
    ],
    content: '<p>正文</p>',
  });
  root = createRoot(host);
  await act(async () => {
    root.render(
      <PaperToolbar
        editor={editor}
        canInsertMedia={false}
        onInsertLink={() => {}}
        onPickImage={() => {}}
        onPickVideo={() => {}}
        onToggleTable={() => {}}
        onInsertMath={() => {}}
        onFind={() => {}}
        findOpen={false}
      />,
    );
  });
});

afterEach(async () => {
  await act(async () => root.unmount());
  editor.destroy();
  host.remove();
});

function button(label: string): HTMLButtonElement {
  const found = host.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`);
  expect(found).not.toBeNull();
  return found!;
}

function press(label: string): void {
  button(label).dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
}

function rowCount(): number {
  let count = 0;
  editor.state.doc.descendants((node) => {
    if (node.type.name === 'tableRow') count += 1;
  });
  return count;
}

function cellPositions(name: string): number[] {
  const positions: number[] = [];
  editor.state.doc.descendants((node, pos) => {
    if (node.type.name === name) positions.push(pos);
  });
  return positions;
}

it('shows table actions only while the caret is inside a table', async () => {
  expect(host.querySelector('[aria-label="表格操作"]')).toBeNull();
  await act(async () => {
    editor.commands.insertTable({ rows: 3, cols: 3, withHeaderRow: true });
  });
  expect(host.querySelector('[aria-label="表格操作"]')).not.toBeNull();
  expect(button('表头行').getAttribute('aria-pressed')).toBe('true');
  expect(button('表头列').getAttribute('aria-pressed')).toBe('false');
  expect(button('合并单元格').disabled).toBe(true);
  expect(button('拆分单元格').disabled).toBe(true);
  expect(button('删除行').disabled).toBe(false);
});

it('adds and removes rows, toggles the header, and deletes the table', async () => {
  await act(async () => {
    editor.commands.insertTable({ rows: 3, cols: 3, withHeaderRow: true });
  });
  expect(rowCount()).toBe(3);
  await act(async () => press('下方加行'));
  expect(rowCount()).toBe(4);
  await act(async () => press('表头行'));
  expect(button('表头行').getAttribute('aria-pressed')).toBe('false');
  expect(cellPositions('tableHeader')).toHaveLength(0);
  await act(async () => press('删除表格'));
  expect(host.querySelector('[aria-label="表格操作"]')).toBeNull();
  expect(rowCount()).toBe(0);
});

it('merges a cell selection, splits it, and paints the cell background', async () => {
  await act(async () => {
    editor.commands.insertTable({ rows: 3, cols: 3, withHeaderRow: true });
  });
  const cells = cellPositions('tableCell');
  await act(async () => {
    editor.commands.setCellSelection({ anchorCell: cells[0]!, headCell: cells[1]! });
  });
  expect(button('合并单元格').disabled).toBe(false);
  await act(async () => press('合并单元格'));
  let colspan = 1;
  editor.state.doc.descendants((node) => {
    if (node.type.name === 'tableCell' && typeof node.attrs.colspan === 'number') {
      colspan = Math.max(colspan, node.attrs.colspan);
    }
  });
  expect(colspan).toBe(2);
  expect(button('拆分单元格').disabled).toBe(false);
  await act(async () => press('拆分单元格'));
  editor.state.doc.descendants((node) => {
    if (node.type.name === 'tableCell') expect(node.attrs.colspan).toBe(1);
  });

  await act(async () => press('单元格背景'));
  const yellow = document.querySelector<HTMLButtonElement>('button[aria-label="黄"]');
  expect(yellow).not.toBeNull();
  await act(async () => yellow!.click());
  let painted = false;
  editor.state.doc.descendants((node) => {
    if (node.attrs.backgroundColor === '#f6e7a8') painted = true;
  });
  expect(painted).toBe(true);
});

it('refuses to delete the only row', async () => {
  await act(async () => {
    editor.commands.insertTable({ rows: 1, cols: 2, withHeaderRow: false });
  });
  expect(button('删除行').disabled).toBe(true);
  expect(button('删除列').disabled).toBe(false);
  expect(rowCount()).toBe(1);
});
