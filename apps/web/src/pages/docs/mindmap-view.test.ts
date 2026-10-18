import { beforeEach, describe, expect, it } from 'vitest';
import { mindSessionFor, rememberMindSession, resetMindSessions } from './mindmap-view';

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
