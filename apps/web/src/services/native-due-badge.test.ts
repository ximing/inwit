import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  dueBadgeKind,
  resetNativeDueBadgeSyncForTests,
  shownDueCount,
  syncNativeDueBadge,
  type NativeDueBadgeHandle,
} from './native-due-badge';

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((ok) => {
    resolve = ok;
  });
  return { promise, resolve };
}

function mockWindow(): NativeDueBadgeHandle {
  return {
    setBadgeCount: vi.fn(async () => undefined),
    setOverlayIcon: vi.fn(async () => undefined),
  };
}

afterEach(() => {
  resetNativeDueBadgeSyncForTests();
});

describe('dueBadgeKind', () => {
  it('uses the numeric badge on macOS and Linux', () => {
    expect(dueBadgeKind('Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0)')).toBe('count');
    expect(dueBadgeKind('Mozilla/5.0 (X11; Linux x86_64)')).toBe('count');
  });

  it('uses a taskbar overlay on Windows', () => {
    expect(dueBadgeKind('Mozilla/5.0 (Windows NT 10.0; Win64; x64)')).toBe('overlay');
  });
});

describe('shownDueCount', () => {
  it('keeps a non-negative integer', () => {
    expect(shownDueCount(3.8)).toBe(3);
    expect(shownDueCount(0)).toBe(0);
    expect(shownDueCount(-2)).toBe(0);
    expect(shownDueCount(Number.NaN)).toBe(0);
  });
});

describe('syncNativeDueBadge', () => {
  it('is a no-op outside Tauri', async () => {
    const win = mockWindow();
    await syncNativeDueBadge(4, {
      isTauri: () => false,
      loadWindow: async () => win,
    });
    expect(win.setBadgeCount).not.toHaveBeenCalled();
    expect(win.setOverlayIcon).not.toHaveBeenCalled();
  });

  it('sets the dock count and clears it at zero', async () => {
    const win = mockWindow();
    await syncNativeDueBadge(3, {
      isTauri: () => true,
      platform: () => 'count',
      loadWindow: async () => win,
    });
    expect(win.setBadgeCount).toHaveBeenCalledWith(3);

    await syncNativeDueBadge(0, {
      isTauri: () => true,
      platform: () => 'count',
      loadWindow: async () => win,
    });
    expect(win.setBadgeCount).toHaveBeenLastCalledWith(undefined);
    expect(win.setOverlayIcon).not.toHaveBeenCalled();
  });

  it('draws a Windows overlay and clears it at zero', async () => {
    const win = mockWindow();
    const png = new Uint8Array([1, 2, 3]);
    const renderOverlay = vi.fn(async () => png);
    await syncNativeDueBadge(8, {
      isTauri: () => true,
      platform: () => 'overlay',
      loadWindow: async () => win,
      renderOverlay,
    });
    expect(renderOverlay).toHaveBeenCalledWith(8);
    expect(win.setOverlayIcon).toHaveBeenCalledWith(png);
    expect(win.setBadgeCount).not.toHaveBeenCalled();

    await syncNativeDueBadge(0, {
      isTauri: () => true,
      platform: () => 'overlay',
      loadWindow: async () => win,
      renderOverlay,
    });
    expect(win.setOverlayIcon).toHaveBeenLastCalledWith(undefined);
    expect(renderOverlay).toHaveBeenCalledTimes(1);
  });

  it('drops a stale sync when a newer count is already queued', async () => {
    const win = mockWindow();
    const first = deferred<NativeDueBadgeHandle>();
    const stale = syncNativeDueBadge(9, {
      isTauri: () => true,
      platform: () => 'count',
      loadWindow: () => first.promise,
    });
    await Promise.resolve();
    const latest = syncNativeDueBadge(2, {
      isTauri: () => true,
      platform: () => 'count',
      loadWindow: async () => win,
    });
    first.resolve(win);
    await Promise.all([stale, latest]);
    expect(win.setBadgeCount).toHaveBeenCalledTimes(1);
    expect(win.setBadgeCount).toHaveBeenCalledWith(2);
  });

  it('swallows load and IPC failures', async () => {
    await expect(
      syncNativeDueBadge(1, {
        isTauri: () => true,
        platform: () => 'count',
        loadWindow: async () => {
          throw new Error('no window');
        },
      }),
    ).resolves.toBeUndefined();

    const win = mockWindow();
    vi.mocked(win.setBadgeCount).mockRejectedValueOnce(new Error('denied'));
    await expect(
      syncNativeDueBadge(4, {
        isTauri: () => true,
        platform: () => 'count',
        loadWindow: async () => win,
      }),
    ).resolves.toBeUndefined();
  });
});
