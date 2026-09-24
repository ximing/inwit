import { isTauriRuntime } from './runtime';

export const NATIVE_COMMAND = {
  captureRegion: 'capture_region',
  clipboardImage: 'clipboard_image',
} as const;

export const NATIVE_EVENT = {
  screenshotCaptured: 'screenshot-captured',
  screenshotFailed: 'screenshot-failed',
} as const;

type NativeWindowHandle = {
  setTheme(theme: 'light' | 'dark'): Promise<void>;
  setBackgroundColor(color: string): Promise<void>;
};

export async function invokeNative<T>(command: string): Promise<T | undefined> {
  if (!isTauriRuntime()) return undefined;
  const { invoke } = await import('@tauri-apps/api/core');
  return invoke<T>(command);
}

export async function listenNative<T>(
  event: (typeof NATIVE_EVENT)[keyof typeof NATIVE_EVENT],
  handler: (payload: T) => void,
): Promise<() => void> {
  if (!isTauriRuntime()) return () => undefined;
  const { listen } = await import('@tauri-apps/api/event');
  return listen<T>(event, (message) => {
    handler(message.payload);
  });
}

export async function loadNativeWindow(): Promise<NativeWindowHandle | null> {
  if (!isTauriRuntime()) return null;
  const { getCurrentWindow } = await import('@tauri-apps/api/window');
  const win = getCurrentWindow();
  return {
    setTheme: (theme) => win.setTheme(theme),
    setBackgroundColor: (color) => win.setBackgroundColor(color),
  };
}
