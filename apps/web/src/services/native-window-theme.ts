import { isTauriRuntime } from '@/api/tauri';

/** Matches `html[data-theme=light] { --bg }` in apps/web/src/styles.css. */
export const LIGHT_WINDOW_CANVAS = '#F6F3EC';
/** Matches `html[data-theme=dark] { --bg }` in apps/web/src/styles.css. */
export const DARK_WINDOW_CANVAS = '#1C1915';

export type WindowScheme = 'light' | 'dark';

export type NativeWindowHandle = {
  setTheme(theme: WindowScheme): Promise<void>;
  setBackgroundColor(color: string): Promise<void>;
};

export type NativeWindowThemeDeps = {
  isTauri?: () => boolean;
  loadWindow?: () => Promise<NativeWindowHandle>;
};

let generation = 0;
let queue: Promise<void> = Promise.resolve();

export function windowCanvasColor(scheme: WindowScheme): string {
  return scheme === 'dark' ? DARK_WINDOW_CANVAS : LIGHT_WINDOW_CANVAS;
}

function defaultIsTauri(): boolean {
  return isTauriRuntime();
}

async function defaultLoadWindow(): Promise<NativeWindowHandle> {
  const { getCurrentWindow } = await import('@tauri-apps/api/window');
  return getCurrentWindow();
}

/**
 * Drive the system titlebar from the resolved app scheme.
 * Pass `'light' | 'dark'` — never `null` for “follow OS”.
 */
export function syncNativeWindowTheme(
  scheme: WindowScheme,
  deps: NativeWindowThemeDeps = {},
): Promise<void> {
  const token = ++generation;
  const run = async (): Promise<void> => {
    if (token !== generation) return;
    const isTauri = deps.isTauri ?? defaultIsTauri;
    if (!isTauri()) return;
    try {
      const load = deps.loadWindow ?? defaultLoadWindow;
      const win = await load();
      if (token !== generation) return;
      await Promise.all([
        win.setTheme(scheme),
        win.setBackgroundColor(windowCanvasColor(scheme)),
      ]);
    } catch {
      // Browser, missing permission, or IPC failure — page theme still applies.
    }
  };
  queue = queue.then(run, run);
  return queue;
}

export function resetNativeWindowThemeSyncForTests(): void {
  generation = 0;
  queue = Promise.resolve();
}
