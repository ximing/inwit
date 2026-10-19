import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { loadWorkspaceState, saveWorkspaceState } from './study-state';
import { StudyWorkspaceService } from './study-workspace.service';

function memoryStorage(): Storage {
  const map = new Map<string, string>();
  return {
    get length() {
      return map.size;
    },
    clear: () => map.clear(),
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => {
      map.set(key, String(value));
    },
    removeItem: (key) => {
      map.delete(key);
    },
    key: (index) => [...map.keys()][index] ?? null,
  };
}

describe('StudyWorkspaceService', () => {
  beforeEach(() => {
    vi.stubGlobal('window', {
      localStorage: memoryStorage(),
      sessionStorage: memoryStorage(),
    });
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  function service(): StudyWorkspaceService {
    const workspace = new StudyWorkspaceService();
    vi.spyOn(workspace, 'userId', 'get').mockReturnValue('user-1');
    return workspace;
  }

  it('keeps the selected mode and compare split when opening another article', () => {
    const workspace = service();
    workspace.boot('doc-a:topic');
    workspace.setMode('concepts');
    workspace.setDockRatio(0.7);
    workspace.boot('doc-b:topic');
    expect(workspace.layout.preferredMode).toBe('concepts');
    expect(workspace.layout.dockRatio).toBe(0.7);
    const state = loadWorkspaceState('user-1');
    expect(state.layout?.preferredMode).toBe('concepts');
    expect(state.layout?.dockRatio).toBe(0.7);
    expect(state.layouts['doc-b:topic']).toBeUndefined();
  });

  it('adopts one saved article layout as the global layout, then ignores the rest', () => {
    saveWorkspaceState('user-1', {
      layouts: {
        'doc-a:topic': {
          preferredMode: 'compare',
          arrangement: 'columns',
          mainRatio: 0.5,
          dockRatio: 0.35,
          zoomedPane: 'outline',
        },
        'doc-b:topic': {
          preferredMode: 'outline',
          arrangement: 'stacked',
          mainRatio: 0.62,
          dockRatio: 0.5,
          zoomedPane: null,
        },
      },
      viewports: {},
    });
    const workspace = service();
    workspace.boot('doc-a:topic');
    expect(workspace.layout.preferredMode).toBe('compare');
    expect(workspace.layout.dockRatio).toBe(0.35);
    expect(workspace.layout.zoomedPane).toBeNull();
    workspace.boot('doc-b:topic');
    expect(workspace.layout.preferredMode).toBe('compare');
    expect(loadWorkspaceState('user-1').layout?.arrangement).toBe('columns');
  });

  it('still saves after the debounce when the article stays open', () => {
    const workspace = service();
    workspace.boot('doc-a:topic');
    workspace.setMode('compare');
    expect(loadWorkspaceState('user-1').layout).toBeUndefined();
    vi.advanceTimersByTime(500);
    expect(loadWorkspaceState('user-1').layout?.preferredMode).toBe('compare');
  });
});
