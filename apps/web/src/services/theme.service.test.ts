import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { syncNativeWindowTheme } = vi.hoisted(() => ({
  syncNativeWindowTheme: vi.fn(() => Promise.resolve()),
}));

vi.mock('./native-window-theme', () => ({
  syncNativeWindowTheme,
}));

import { ThemeService } from './theme.service';

type MediaStub = {
  matches: boolean;
  addEventListener: (name: string, fn: () => void) => void;
};

function installDom(pref: string | null, systemDark: boolean): {
  dataset: Record<string, string>;
  media: MediaStub;
  listeners: Array<() => void>;
  setItem: ReturnType<typeof vi.fn>;
} {
  const listeners: Array<() => void> = [];
  const media: MediaStub = {
    matches: systemDark,
    addEventListener: (_name, fn) => {
      listeners.push(fn);
    },
  };
  const dataset: Record<string, string> = {};
  const setItem = vi.fn();
  vi.stubGlobal('window', {
    matchMedia: () => media,
  });
  vi.stubGlobal('document', { documentElement: { dataset } });
  vi.stubGlobal('localStorage', {
    getItem: () => pref,
    setItem,
  });
  return { dataset, media, listeners, setItem };
}

describe('ThemeService', () => {
  beforeEach(() => {
    syncNativeWindowTheme.mockClear();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('syncs the resolved scheme on startup', () => {
    const { dataset } = installDom('dark', false);
    const theme = new ThemeService();
    expect(theme.preference).toBe('dark');
    expect(theme.resolved).toBe('dark');
    expect(dataset.theme).toBe('dark');
    expect(syncNativeWindowTheme).toHaveBeenCalledWith('dark');
  });

  it('resolves follow-system to the OS scheme and resyncs when it changes', () => {
    const { dataset, media, listeners } = installDom('system', true);
    const theme = new ThemeService();
    expect(theme.resolved).toBe('dark');
    expect(syncNativeWindowTheme).toHaveBeenCalledWith('dark');

    media.matches = false;
    for (const fn of listeners) fn();
    expect(theme.resolved).toBe('light');
    expect(dataset.theme).toBe('light');
    expect(syncNativeWindowTheme).toHaveBeenLastCalledWith('light');
  });

  it('keeps a forced light scheme when the OS is dark', () => {
    const { dataset, media, listeners } = installDom('light', true);
    const theme = new ThemeService();
    expect(theme.resolved).toBe('light');
    expect(dataset.theme).toBe('light');
    expect(syncNativeWindowTheme).toHaveBeenCalledWith('light');

    media.matches = false;
    for (const fn of listeners) fn();
    expect(theme.resolved).toBe('light');
    expect(syncNativeWindowTheme).toHaveBeenLastCalledWith('light');
  });

  it('writes preference and syncs the resolved scheme on toggle', () => {
    const { setItem } = installDom('light', true);
    const theme = new ThemeService();
    theme.setPreference('dark');
    expect(setItem).toHaveBeenCalledWith('inwit-theme', 'dark');
    expect(theme.resolved).toBe('dark');
    expect(syncNativeWindowTheme).toHaveBeenLastCalledWith('dark');
  });
});
