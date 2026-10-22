import { describe, expect, it } from 'vitest';
import type { MindBox } from './mindmap-layout.js';
import { edgePath, ghostPath, ghostTargetIds, hintFor, type GhostLinkEnd } from './mindmap-edges.js';

const from: MindBox = { id: 'from', x: 0, y: 0, width: 100, height: 40 };
const toRight: MindBox = { id: 'right', x: 200, y: 10, width: 40, height: 20 };
const toLeft: MindBox = { id: 'left', x: -80, y: 10, width: 40, height: 20 };

function end(id: string, documentId: string | null): GhostLinkEnd {
  return { card: { id, documentId } };
}

describe('hintFor', () => {
  it('rejects an empty plan and every reason except depth', () => {
    expect(hintFor({ kind: 'root' }, null)).toEqual({ text: '不能放到这里', accept: false });
    expect(hintFor({ kind: 'child' }, { ok: false, reason: 'missing' })).toEqual({
      text: '不能放到这里',
      accept: false,
    });
    expect(hintFor({ kind: 'before' }, { ok: false, reason: 'self' }, 3)).toEqual({
      text: '不能放到这里',
      accept: false,
    });
    expect(hintFor({ kind: 'after' }, { ok: false, reason: 'cycle' })).toEqual({
      text: '不能放到这里',
      accept: false,
    });
  });

  it('names a depth rejection and stays silent when the place does not change', () => {
    expect(hintFor({ kind: 'child' }, { ok: false, reason: 'depth' }, 4)).toEqual({
      text: '层级太深了',
      accept: false,
    });
    expect(hintFor({ kind: 'root' }, { ok: true, unchanged: true }, 2)).toEqual({
      text: null,
      accept: false,
    });
  });

  it('names the drop and prefixes a count above one', () => {
    const changed = { ok: true as const, unchanged: false };
    expect(hintFor({ kind: 'root' }, changed)).toEqual({ text: '独立成树', accept: true });
    expect(hintFor({ kind: 'child' }, changed)).toEqual({ text: '成为子节点', accept: true });
    expect(hintFor({ kind: 'before' }, changed)).toEqual({ text: '排在前面', accept: true });
    expect(hintFor({ kind: 'after' }, changed)).toEqual({ text: '排在后面', accept: true });
    expect(hintFor({ kind: 'root' }, changed, 3)).toEqual({ text: '3 个节点：独立成树', accept: true });
    expect(hintFor({ kind: 'child' }, changed, 2)).toEqual({ text: '2 个节点：成为子节点', accept: true });
    expect(hintFor({ kind: 'before' }, changed, 4)).toEqual({ text: '4 个节点：排在前面', accept: true });
    expect(hintFor({ kind: 'after' }, changed, 5)).toEqual({ text: '5 个节点：排在后面', accept: true });
  });
});

describe('edgePath', () => {
  it('leaves the source on the right and enters the target on the left', () => {
    expect(edgePath(from, toRight)).toBe('M 100 20 C 150 20, 150 20, 200 20');
  });

  it('keeps the same side points when the target sits to the left', () => {
    expect(edgePath(from, toLeft)).toBe('M 100 20 C 124 20, -104 20, -80 20');
  });
});

describe('ghostPath', () => {
  it('joins centers and bends toward the right when the target is to the right', () => {
    expect(ghostPath(from, toRight)).toBe('M 50 20 C 135 20, 135 20, 220 20');
  });

  it('bends toward the left when the target center is to the left', () => {
    expect(ghostPath(from, toLeft)).toBe('M 50 20 C -5 20, -5 20, -60 20');
  });

  it('clamps the center bend between 32 and 140', () => {
    const near: MindBox = { id: 'near', x: 20, y: 0, width: 20, height: 20 };
    const far: MindBox = { id: 'far', x: 400, y: 0, width: 20, height: 20 };
    const tiny: MindBox = { id: 'tiny', x: 0, y: 0, width: 20, height: 20 };
    expect(ghostPath(tiny, near)).toBe('M 10 10 C 42 10, -2 10, 30 10');
    expect(ghostPath(tiny, far)).toBe('M 10 10 C 150 10, 270 10, 410 10');
  });
});

describe('ghostTargetIds', () => {
  const placed = new Set(['self', 'out-a', 'out-b', 'in-a', 'dup']);

  it('keeps outgoing then incoming, and drops self, duplicates, other documents, and missing boxes', () => {
    const links = {
      outgoing: [
        end('out-a', 'doc'),
        end('self', 'doc'),
        end('dup', 'doc'),
        end('other-doc', 'elsewhere'),
        end('missing', 'doc'),
        end('blank', null),
      ],
      incoming: [end('dup', 'doc'), end('in-a', 'doc'), end('out-a', 'doc'), end('orphan', null)],
    };
    expect(ghostTargetIds(links, 'self', 'doc', placed)).toEqual(['out-a', 'dup', 'in-a']);
  });

  it('returns nothing without a selected card or a link list', () => {
    const links = { outgoing: [end('out-a', 'doc')], incoming: [] };
    expect(ghostTargetIds(null, 'self', 'doc', placed)).toEqual([]);
    expect(ghostTargetIds(links, null, 'doc', placed)).toEqual([]);
  });
});
