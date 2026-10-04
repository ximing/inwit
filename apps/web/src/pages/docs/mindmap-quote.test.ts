import type { OutlineNode } from '@inwit/dto';
import { describe, expect, it } from 'vitest';
import { encodeQuoteDrag, parseQuoteDrag, quoteDropPlace } from './mindmap-quote';

const nodes: OutlineNode[] = [
  { id: 'a', parentId: null, position: 0 },
  { id: 'b', parentId: null, position: 1 },
  { id: 'd', parentId: 'a', position: 0 },
];

describe('parseQuoteDrag', () => {
  it('round-trips a valid payload', () => {
    const payload = {
      documentId: 'doc-1',
      quote: '一段引文',
      extra: { anchorBlockIndex: 3, from: 10, to: 20 },
    };
    expect(parseQuoteDrag(encodeQuoteDrag(payload))).toEqual(payload);
  });

  it('rejects malformed payloads', () => {
    expect(parseQuoteDrag(null)).toBeNull();
    expect(parseQuoteDrag('')).toBeNull();
    expect(parseQuoteDrag('not json')).toBeNull();
    expect(parseQuoteDrag('{}')).toBeNull();
    expect(parseQuoteDrag(JSON.stringify({ documentId: 'doc-1', quote: '  ' }))).toBeNull();
    expect(parseQuoteDrag(JSON.stringify({ documentId: '', quote: 'x' }))).toBeNull();
    expect(
      parseQuoteDrag(JSON.stringify({ documentId: 'doc-1', quote: 'x', extra: 'oops' })),
    ).toBeNull();
  });
});

describe('quoteDropPlace', () => {
  it('stays a root when dropped on empty space', () => {
    expect(quoteDropPlace(nodes, { kind: 'root' })).toBeNull();
  });

  it('appends to the child list when dropped on a node', () => {
    expect(quoteDropPlace(nodes, { kind: 'child', parentId: 'a' })).toEqual({
      parentId: 'a',
      index: 1,
    });
    expect(quoteDropPlace(nodes, { kind: 'child', parentId: 'ghost' })).toBeNull();
  });

  it('inserts next to a sibling on the edge bands', () => {
    expect(quoteDropPlace(nodes, { kind: 'before', siblingId: 'b' })).toEqual({
      parentId: null,
      index: 1,
    });
    expect(quoteDropPlace(nodes, { kind: 'after', siblingId: 'b' })).toEqual({
      parentId: null,
      index: 2,
    });
    expect(quoteDropPlace(nodes, { kind: 'before', siblingId: 'd' })).toEqual({
      parentId: 'a',
      index: 0,
    });
  });

  it('falls back to a root when the target is already at max depth', () => {
    const deep: OutlineNode[] = [
      { id: 'n1', parentId: null, position: 0 },
      { id: 'n2', parentId: 'n1', position: 0 },
      { id: 'n3', parentId: 'n2', position: 0 },
      { id: 'n4', parentId: 'n3', position: 0 },
      { id: 'n5', parentId: 'n4', position: 0 },
      { id: 'n6', parentId: 'n5', position: 0 },
      { id: 'n7', parentId: 'n6', position: 0 },
      { id: 'n8', parentId: 'n7', position: 0 },
    ];
    expect(quoteDropPlace(deep, { kind: 'child', parentId: 'n8' })).toBeNull();
    expect(quoteDropPlace(deep, { kind: 'after', siblingId: 'n8' })).toEqual({
      parentId: 'n7',
      index: 1,
    });
    expect(quoteDropPlace(deep, { kind: 'child', parentId: 'n7' })).toEqual({
      parentId: 'n7',
      index: 1,
    });
  });
});
