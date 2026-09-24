import { describe, expect, it } from 'vitest';
import { isTauriRuntime } from './runtime';

describe('isTauriRuntime', () => {
  it('is false without __TAURI_INTERNALS__ and true when it is present', () => {
    expect(isTauriRuntime({})).toBe(false);
    expect(isTauriRuntime(null)).toBe(false);
    expect(isTauriRuntime({ __TAURI_INTERNALS__: undefined })).toBe(false);
    expect(isTauriRuntime({ __TAURI_INTERNALS__: {} })).toBe(true);
  });
});
