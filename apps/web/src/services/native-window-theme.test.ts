import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  DARK_WINDOW_CANVAS,
  LIGHT_WINDOW_CANVAS,
  resetNativeWindowThemeSyncForTests,
  syncNativeWindowTheme,
  windowCanvasColor,
} from './native-window-theme';

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((ok) => {
    resolve = ok;
  });
  return { promise, resolve };
}

function mockWindow() {
  return {
    setTheme: vi.fn(async () => undefined),
    setBackgroundColor: vi.fn(async () => undefined),
  };
}

afterEach(() => {
  resetNativeWindowThemeSyncForTests();
});

describe('windowCanvasColor', () => {
  it('uses the app canvas tokens', () => {
    expect(windowCanvasColor('light')).toBe(LIGHT_WINDOW_CANVAS);
    expect(windowCanvasColor('dark')).toBe(DARK_WINDOW_CANVAS);
    expect(LIGHT_WINDOW_CANVAS.toLowerCase()).toBe('#f6f3ec');
    expect(DARK_WINDOW_CANVAS.toLowerCase()).toBe('#1c1915');
  });
});

describe('syncNativeWindowTheme', () => {
  it('is a no-op outside Tauri', async () => {
    const win = mockWindow();
    await syncNativeWindowTheme('dark', {
      isTauri: () => false,
      loadWindow: async () => win,
    });
    expect(win.setTheme).not.toHaveBeenCalled();
    expect(win.setBackgroundColor).not.toHaveBeenCalled();
  });

  it('sets the resolved light scheme and paper canvas', async () => {
    const win = mockWindow();
    await syncNativeWindowTheme('light', {
      isTauri: () => true,
      loadWindow: async () => win,
    });
    expect(win.setTheme).toHaveBeenCalledTimes(1);
    expect(win.setTheme).toHaveBeenCalledWith('light');
    expect(win.setBackgroundColor).toHaveBeenCalledWith(LIGHT_WINDOW_CANVAS);
  });

  it('sets the resolved dark scheme and dark canvas', async () => {
    const win = mockWindow();
    await syncNativeWindowTheme('dark', {
      isTauri: () => true,
      loadWindow: async () => win,
    });
    expect(win.setTheme).toHaveBeenCalledWith('dark');
    expect(win.setBackgroundColor).toHaveBeenCalledWith(DARK_WINDOW_CANVAS);
  });

  it('drops a stale sync when a newer one starts first', async () => {
    const win = mockWindow();
    const first = deferred<typeof win>();
    const stale = syncNativeWindowTheme('dark', {
      isTauri: () => true,
      loadWindow: () => first.promise,
    });
    await Promise.resolve();
    const latest = syncNativeWindowTheme('light', {
      isTauri: () => true,
      loadWindow: async () => win,
    });
    first.resolve(win);
    await Promise.all([stale, latest]);
    expect(win.setTheme).toHaveBeenCalledTimes(1);
    expect(win.setTheme).toHaveBeenCalledWith('light');
    expect(win.setBackgroundColor).toHaveBeenCalledWith(LIGHT_WINDOW_CANVAS);
  });

  it('swallows load and IPC failures', async () => {
    await expect(
      syncNativeWindowTheme('dark', {
        isTauri: () => true,
        loadWindow: async () => {
          throw new Error('no window module');
        },
      }),
    ).resolves.toBeUndefined();

    const win = mockWindow();
    win.setTheme.mockRejectedValueOnce(new Error('denied'));
    await expect(
      syncNativeWindowTheme('light', {
        isTauri: () => true,
        loadWindow: async () => win,
      }),
    ).resolves.toBeUndefined();
  });
});
