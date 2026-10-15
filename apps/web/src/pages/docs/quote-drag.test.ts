import { describe, expect, it } from 'vitest';
import type { MindDrop } from './mindmap-hit';
import {
  pointerInsideRect,
  quoteDragCommit,
  quoteDragDown,
  quoteDragLabel,
  quoteDragMove,
  quoteDropCaption,
} from './quote-drag';

const payload = { documentId: 'doc-1', quote: '一段引文' };

describe('quoteDragMove', () => {
  it('stays pending until the pointer travels past the arm distance', () => {
    const down = quoteDragDown(payload, 10, 10);
    const nudge = quoteDragMove(down, 12, 11);
    expect(nudge.phase).toBe('pending');
    expect(quoteDragCommit(nudge, true)).toBeNull();

    const armed = quoteDragMove(down, 20, 10);
    expect(armed.phase).toBe('dragging');
    expect(quoteDragCommit(armed, true)).toEqual(payload);
    expect(quoteDragCommit(armed, false)).toBeNull();
  });

  it('keeps dragging once armed', () => {
    const armed = quoteDragMove(quoteDragDown(payload, 0, 0), 30, 0);
    const moved = quoteDragMove(armed, 4, 8);
    expect(moved).toEqual({ phase: 'dragging', x: 4, y: 8, payload });
  });
});

describe('pointerInsideRect', () => {
  const rect = { left: 10, top: 20, right: 110, bottom: 220 };

  it('includes the edges and rejects the outside', () => {
    expect(pointerInsideRect(rect, 10, 20)).toBe(true);
    expect(pointerInsideRect(rect, 110, 220)).toBe(true);
    expect(pointerInsideRect(rect, 9, 20)).toBe(false);
    expect(pointerInsideRect(null, 10, 20)).toBe(false);
  });
});

describe('quoteDragLabel', () => {
  it('flattens whitespace and clips by grapheme', () => {
    expect(quoteDragLabel('  第一行\n第二行  ')).toBe('第一行 第二行');
    expect(quoteDragLabel('甲'.repeat(50), 4)).toBe('甲甲甲甲…');
  });
});

describe('quoteDropCaption', () => {
  it('names each drop', () => {
    const drops: Array<MindDrop | null> = [
      null,
      { kind: 'child', parentId: 'a' },
      { kind: 'before', siblingId: 'a' },
      { kind: 'after', siblingId: 'a' },
      { kind: 'root' },
    ];
    expect(drops.map(quoteDropCaption)).toEqual([
      '拖到脑图',
      '落为子节点',
      '排在前面',
      '排在后面',
      '独立成树',
    ]);
  });
});
