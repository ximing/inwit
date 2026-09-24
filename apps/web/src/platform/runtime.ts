export function isTauriRuntime(
  target?: { __TAURI_INTERNALS__?: unknown } | null,
): boolean {
  const value =
    target === undefined
      ? (globalThis as { window?: { __TAURI_INTERNALS__?: unknown } }).window
      : target;
  return value != null && value.__TAURI_INTERNALS__ !== undefined;
}
