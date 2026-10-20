// @vitest-environment happy-dom
import { DocTableCell, DocTableHeader } from '@inwit/doc-schema';
import { Table, TableRow } from '@tiptap/extension-table';
import { CellSelection, cellAround } from '@tiptap/pm/tables';
import { Editor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { tableClickSelection } from './table-actions';
import { tableKeys } from './table-keys';

let editor: Editor;

beforeEach(() => {
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
});

afterEach(() => {
  editor.destroy();
});

function shape(): { rows: number; cols: number } {
  let rows = 0;
  let cols = 0;
  editor.state.doc.descendants((node) => {
    if (node.type.name !== 'tableRow') return;
    rows += 1;
    if (cols === 0) {
      node.forEach((cell) => {
        cols += typeof cell.attrs.colspan === 'number' ? cell.attrs.colspan : 1;
      });
    }
  });
  return { rows, cols };
}

const mac = /Mac|iPhone|iPad|iPod/.test(navigator.platform);

function press(key: string, shift = false): void {
  const event = new KeyboardEvent('keydown', {
    key,
    metaKey: mac,
    ctrlKey: !mac,
    shiftKey: shift,
    bubbles: true,
    cancelable: true,
  });
  editor.view.someProp('handleKeyDown', (handle) => (handle(editor.view, event) ? true : false));
}

function cellPositions(name: string): number[] {
  const positions: number[] = [];
  editor.state.doc.descendants((node, pos) => {
    if (node.type.name === name) positions.push(pos);
  });
  return positions;
}

it('adds a row or column with command and the arrow keys', () => {
  editor.commands.insertTable({ rows: 3, cols: 3, withHeaderRow: true });
  expect(shape()).toEqual({ rows: 3, cols: 3 });

  press('ArrowRight');
  expect(shape().cols).toBe(4);
  press('ArrowLeft');
  expect(shape().cols).toBe(5);
  press('ArrowDown');
  expect(shape().rows).toBe(4);
  press('ArrowUp');
  expect(shape().rows).toBe(5);

  press('ArrowUp', true);
  expect(shape().rows).toBe(4);
  press('ArrowLeft', true);
  expect(shape().cols).toBe(4);
});

it('leaves text navigation alone outside a table and refuses to delete the only row', () => {
  const before = editor.getJSON();
  press('ArrowDown');
  press('ArrowLeft', true);
  expect(editor.getJSON()).toEqual(before);

  editor.commands.insertTable({ rows: 1, cols: 2, withHeaderRow: false });
  press('ArrowUp', true);
  press('ArrowDown', true);
  expect(shape()).toEqual({ rows: 1, cols: 2 });
  press('ArrowRight', true);
  expect(shape()).toEqual({ rows: 1, cols: 1 });
});

it('keeps a cell selection on right-click and moves the caret to another cell', () => {
  editor.commands.insertTable({ rows: 3, cols: 3, withHeaderRow: true });
  const cells = cellPositions('tableCell');
  const anchor = cells[0]!;
  const head = cells[1]!;
  const other = cells[2]!;
  editor.commands.setTextSelection(anchor + 2);
  expect(tableClickSelection(editor.state, anchor + 2)).toBeNull();

  editor.commands.setCellSelection({ anchorCell: anchor, headCell: head });
  expect(editor.state.selection).toBeInstanceOf(CellSelection);
  expect(tableClickSelection(editor.state, anchor + 2)).toBeNull();

  const next = tableClickSelection(editor.state, other + 2);
  expect(next).not.toBeNull();
  expect(cellAround(next!.$from)?.pos).toBe(other);
});
