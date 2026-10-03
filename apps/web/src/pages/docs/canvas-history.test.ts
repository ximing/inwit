import { describe, expect, it } from 'vitest';
import { CanvasHistory } from './canvas-history';

describe('CanvasHistory', () => {
  it('undoes the last edit and redoes it, and a new edit clears the redo stack', () => {
    const history = new CanvasHistory();
    history.push({ type: 'edit', id: 'a', text: '旧' }, { type: 'edit', id: 'a', text: '新' });
    expect(history.peekUndo()).toEqual({ type: 'edit', id: 'a', text: '旧' });
    history.commitUndo();
    expect(history.peekRedo()).toEqual({ type: 'edit', id: 'a', text: '新' });
    history.commitRedo();
    history.push({ type: 'delete', id: 'a' }, { type: 'create', id: 'a', kind: 'text', text: '新', imageKey: null, at: { parentId: null, index: 0 } });
    expect(history.peekRedo()).toBeNull();
    expect(history.undoCount).toBe(2);
  });

  it('points later undos at the id issued when a deleted node is recreated', () => {
    const history = new CanvasHistory();
    history.push(
      { type: 'edit', id: 'old', text: '一' },
      { type: 'edit', id: 'old', text: '二' },
    );
    history.push(
      {
        type: 'restore',
        id: 'old',
        kind: 'text',
        text: '二',
        imageKey: null,
        at: { parentId: 'p', index: 1 },
        children: [{ id: 'child', index: 0 }],
      },
      { type: 'delete', id: 'old' },
    );
    history.commitUndo();
    history.remap('old', 'new');
    expect(history.peekUndo()).toEqual({ type: 'edit', id: 'new', text: '一' });
    expect(history.peekRedo()).toEqual({ type: 'delete', id: 'new' });
  });
});