import type { Node } from 'prosemirror-model';
import { describe, expect, it } from 'vitest';
import { getHeadlessSchema } from '../src/schema/headless.js';
import { tableCellBackground } from '../src/schema/table-cell.js';

function renderedAttrs(node: Node): Record<string, string> {
  const rendered = node.type.spec.toDOM?.(node);
  if (!Array.isArray(rendered)) throw new Error('missing toDOM');
  const attrs = rendered[1];
  if (!attrs || typeof attrs !== 'object' || Array.isArray(attrs)) return {};
  return attrs as Record<string, string>;
}

describe('table cell background', () => {
  it('keeps hex and rgb() and drops anything that could extend a style', () => {
    expect(tableCellBackground('#F6E7A8')).toBe('#f6e7a8');
    expect(tableCellBackground('#abc')).toBe('#aabbcc');
    expect(tableCellBackground('rgb(246, 231, 168)')).toBe('#f6e7a8');
    expect(tableCellBackground('red')).toBeNull();
    expect(tableCellBackground('#f6e7a8;background:url(http://evil)')).toBeNull();
    expect(tableCellBackground('rgb(1, 2, 300)')).toBeNull();
  });

  it('round-trips a cell fill and omits the default', () => {
    const schema = getHeadlessSchema();
    const cell = schema.nodes.tableCell!.create(
      { backgroundColor: '#f6e7a8' },
      schema.nodes.paragraph!.create(),
    );
    expect(cell.attrs.backgroundColor).toBe('#f6e7a8');
    const saved = cell.toJSON() as { attrs: { backgroundColor: string } };
    expect(saved.attrs.backgroundColor).toBe('#f6e7a8');
    const plain = schema.nodes.tableHeader!.create(null, schema.nodes.paragraph!.create());
    expect(plain.attrs.backgroundColor).toBeNull();
    const reloaded = schema.nodeFromJSON(cell.toJSON());
    expect(reloaded.attrs.backgroundColor).toBe('#f6e7a8');
  });

  it('renders a safe fill and ignores a stored unsafe value', () => {
    const schema = getHeadlessSchema();
    const paragraph = schema.nodes.paragraph!.create();
    const header = schema.nodes.tableHeader!.create({ backgroundColor: '#d6e6f7' }, paragraph);
    const unsafe = schema.nodes.tableCell!.create(
      { backgroundColor: 'red;background:url(http://evil)' },
      paragraph,
    );
    expect(renderedAttrs(header).style).toContain('background-color: #d6e6f7');
    const unsafeStyle = renderedAttrs(unsafe).style ?? '';
    expect(unsafeStyle).not.toContain('url(');
    expect(unsafeStyle).not.toContain('red');
  });
});
