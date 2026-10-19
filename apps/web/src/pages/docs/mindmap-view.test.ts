import { beforeEach, describe, expect, it } from 'vitest';
import {
  mindCameraFollow,
  mindSessionFor,
  mindViewAfterNodesRemoved,
  rememberMindSession,
  resetMindSessions,
} from './mindmap-view';

describe('mind map session', () => {
  beforeEach(() => {
    resetMindSessions();
  });

  it('restores the camera and search of the document that owned them', () => {
    rememberMindSession('doc-a', {
      view: { panX: 12, panY: 40, zoom: 1.5 },
      searchQuery: '背包',
      searchOpen: true,
      searchIndex: 2,
      todoOnly: true,
    });
    expect(mindSessionFor('doc-b').view).toEqual({ panX: 28, panY: 28, zoom: 1 });
    expect(mindSessionFor('doc-b').searchQuery).toBe('');
    const restored = mindSessionFor('doc-a');
    expect(restored.view).toEqual({ panX: 12, panY: 40, zoom: 1.5 });
    expect(restored.searchQuery).toBe('背包');
    expect(restored.searchOpen).toBe(true);
    expect(restored.searchIndex).toBe(2);
    expect(restored.todoOnly).toBe(true);
    restored.view.panX = 0;
    expect(mindSessionFor('doc-a').view.panX).toBe(12);
  });
});

describe('mind map camera after nodes change', () => {
  it('refits only when the tree first appears, a node is added, or the user has not panned', () => {
    expect(mindCameraFollow('', 'a|b', false)).toBe('refit');
    expect(mindCameraFollow('a', 'a|b', true)).toBe('refit');
    expect(mindCameraFollow('a|b', 'a|b', false)).toBe('refit');
    expect(mindCameraFollow('a|b', 'a|b', true)).toBe('keep');
    expect(mindCameraFollow('a|b', 'b|a', true)).toBe('keep');
  });

  it('holds the camera when a node is removed, instead of fitting back to the top', () => {
    expect(mindCameraFollow('a|b|c', 'a|c', true)).toBe('hold');
    expect(mindCameraFollow('a|b|c', 'a|c', false)).toBe('keep');
  });

  it('keeps the on-screen node where it was after the tree closes up', () => {
    const view = { panX: 28, panY: -400, zoom: 1 };
    const next = mindViewAfterNodesRemoved({
      previous: [
        { id: 'a', x: 40, y: 40, width: 100, height: 50 },
        { id: 'b', x: 40, y: 500, width: 100, height: 50 },
      ],
      next: [{ id: 'b', x: 40, y: 40, width: 100, height: 50 }],
      view,
      stage: { width: 800, height: 600 },
    });
    expect(next).toEqual({ panX: 28, panY: 60, zoom: 1 });
    expect(40 * next!.zoom + next!.panY).toBe(500 * view.zoom + view.panY);
  });

  it('does not pan when the node still on screen did not move', () => {
    expect(
      mindViewAfterNodesRemoved({
        previous: [
          { id: 'a', x: 40, y: 40, width: 100, height: 50 },
          { id: 'b', x: 40, y: 500, width: 100, height: 50 },
        ],
        next: [{ id: 'a', x: 40, y: 40, width: 100, height: 50 }],
        view: { panX: 28, panY: 36, zoom: 1 },
        stage: { width: 800, height: 600 },
      }),
    ).toBeNull();
  });
});
