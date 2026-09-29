import { describe, expect, it } from 'vitest';
import { getHeadlessSchema } from '../src/index.js';
import { collectDisplayFences } from '../src/schema/math-fold.js';

describe('collectDisplayFences', () => {
  it('joins newline-split $$ fences into one block', () => {
    const schema = getHeadlessSchema();
    const doc = schema.node('doc', null, [
      schema.node('paragraph', null, [schema.text('引入')]),
      schema.node('paragraph', null, [schema.text('$$')]),
      schema.node('paragraph', null, [schema.text('\\int_0^1 x\\,dx')]),
      schema.node('paragraph', null, [schema.text('$$')]),
      schema.node('paragraph', null, [schema.text('结束')]),
    ]);
    const ranges = collectDisplayFences(doc);
    expect(ranges).toHaveLength(1);
    expect(ranges[0]?.node.type.name).toBe('blockMath');
    expect(ranges[0]?.node.attrs.latex).toBe('\\int_0^1 x\\,dx');
    expect(ranges[0]?.from).toBe(doc.child(0).nodeSize);
    expect(ranges[0]?.to).toBe(
      doc.child(0).nodeSize + doc.child(1).nodeSize + doc.child(2).nodeSize + doc.child(3).nodeSize,
    );
  });

  it('leaves an unclosed fence as text', () => {
    const schema = getHeadlessSchema();
    const doc = schema.node('doc', null, [
      schema.node('paragraph', null, [schema.text('$$')]),
      schema.node('paragraph', null, [schema.text('hello world')]),
    ]);
    expect(collectDisplayFences(doc)).toEqual([]);
  });
});
