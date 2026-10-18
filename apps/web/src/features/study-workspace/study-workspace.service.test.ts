import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { loadWorkspaceState } from './study-state';
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

  it('writes a mode change onto the article that scheduled it', () => {
    const workspace = service();
    workspace.boot('doc-a:topic');
    workspace.setMode('concepts');
    workspace.boot('doc-b:topic');
    const state = loadWorkspaceState('user-1');
    expect(state.layouts['doc-a:topic']?.preferredMode).toBe('concepts');
    expect(state.layouts['doc-b:topic']).toBeUndefined();
  });

  it('still saves after the debounce when the article stays open', () => {
    const workspace = service();
    workspace.boot('doc-a:topic');
    workspace.setMode('compare');
    expect(loadWorkspaceState('user-1').layouts['doc-a:topic']).toBeUndefined();
    vi.advanceTimersByTime(500);
    expect(loadWorkspaceState('user-1').layouts['doc-a:topic']?.preferredMode).toBe('compare');
  });
});
