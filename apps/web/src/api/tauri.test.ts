import { describe, expect, it } from 'vitest';
import type { AuthTokens } from '@inwit/dto';
import {
  createTauriTokenStore,
  isTauriRuntime,
  TAURI_DEV_API_URL,
  tauriBaseUrl,
  type TauriKv,
} from './tauri';

function memoryKv(seed: Record<string, unknown> = {}): TauriKv & { data: Record<string, unknown> } {
  const data = { ...seed };
  return {
    data,
    get: async (key) => data[key],
    set: async (key, value) => {
      data[key] = value;
    },
    delete: async (key) => {
      delete data[key];
    },
    save: async () => undefined,
  };
}

describe('isTauriRuntime', () => {
  it('is false without __TAURI_INTERNALS__', () => {
    expect(isTauriRuntime({})).toBe(false);
    expect(isTauriRuntime(null)).toBe(false);
  });

  it('is true when the Tauri internals object is present', () => {
    expect(isTauriRuntime({ __TAURI_INTERNALS__: {} })).toBe(true);
  });
});

describe('tauriBaseUrl', () => {
  it('uses the local API in DEV', () => {
    expect(tauriBaseUrl({ DEV: true })).toBe(TAURI_DEV_API_URL);
  });

  it('requires VITE_TAURI_API_URL in production', () => {
    expect(() => tauriBaseUrl({ DEV: false })).toThrow(/VITE_TAURI_API_URL/);
    expect(tauriBaseUrl({ DEV: false, VITE_TAURI_API_URL: 'https://inwit.aimo.plus/' })).toBe(
      'https://inwit.aimo.plus',
    );
  });
});

describe('createTauriTokenStore', () => {
  const tokens: AuthTokens = {
    accessToken: 'acc',
    refreshToken: 'ref',
    expiresIn: 900,
  };

  it('round-trips access and refresh tokens', async () => {
    const kv = memoryKv();
    const store = createTauriTokenStore(kv);
    await store.setTokens(tokens);
    expect(await store.getAccessToken()).toBe('acc');
    expect(await store.getRefreshToken()).toBe('ref');
    await store.clear();
    expect(await store.getAccessToken()).toBeNull();
    expect(await store.getRefreshToken()).toBeNull();
  });
});
