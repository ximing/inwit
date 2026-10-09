import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { LlmConfigRow } from '../db/schema.js';
import { AppError } from '../errors.js';

const SYSTEM_KEY = 'system-dashscope-key-must-not-be-used';

vi.mock('../config.js', () => ({
  config: {
    DASHSCOPE_API_KEY: 'system-dashscope-key-must-not-be-used',
    LLM_KEY_ENCRYPTION_KEY: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
  },
}));

vi.mock('../net/public-url.js', () => ({
  REQUEST_ENDPOINT_CODES: {
    invalid: 'VALIDATION_ERROR',
    blocked: 'VALIDATION_ERROR',
    lookupFailed: 'VALIDATION_ERROR',
  },
  assertPublicHttpUrl: (raw: string) => new URL(raw),
  assertResolvedPublic: async () => [{ address: '1.1.1.1', family: 4 }],
}));

import { config } from '../config.js';

const state = vi.hoisted(() => ({
  rows: [] as unknown[],
}));

vi.mock('../db/index.js', () => ({
  getDb: () => ({
    select: () => {
      const query = {
        from() {
          return query;
        },
        where() {
          return query;
        },
        limit: () => Promise.resolve(state.rows),
      };
      return query;
    },
  }),
}));

import { encryptSecret } from './crypto.js';
import { LlmConfigUnavailableError, resolveModelFor } from './pi.js';

const USER_ID = 'user-1';
const CONFIG_ID = '11111111-1111-4111-8111-111111111111';

function watchSystemKey(): { reads: () => number; restore: () => void } {
  const original = config.DASHSCOPE_API_KEY;
  let reads = 0;
  Object.defineProperty(config, 'DASHSCOPE_API_KEY', {
    configurable: true,
    enumerable: true,
    get() {
      reads += 1;
      return original;
    },
  });
  return {
    reads: () => reads,
    restore() {
      Object.defineProperty(config, 'DASHSCOPE_API_KEY', {
        configurable: true,
        enumerable: true,
        writable: true,
        value: original,
      });
    },
  };
}

function llmRow(apiKeyEncrypted: string): LlmConfigRow {
  return {
    id: CONFIG_ID,
    userId: USER_ID,
    provider: 'openai',
    apiKeyEncrypted,
    model: 'gpt-4o-mini',
    isDefault: true,
    baseUrl: 'https://api.openai.com/v1',
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

describe('resolveModelFor', () => {
  let systemKey: ReturnType<typeof watchSystemKey>;

  beforeEach(() => {
    state.rows = [];
    systemKey = watchSystemKey();
  });

  afterEach(() => {
    systemKey.restore();
  });

  it('throws LLM_NOT_CONFIGURED and does not read the system key when there is no default', async () => {
    state.rows = [];
    const err = await resolveModelFor(USER_ID).then(
      () => null,
      (caught: unknown) => caught,
    );
    expect(err).toBeInstanceOf(AppError);
    expect(err).toMatchObject({
      status: 400,
      code: 'LLM_NOT_CONFIGURED',
      message: '还没有配置大模型',
    });
    expect(systemKey.reads()).toBe(0);
    expect(JSON.stringify(err)).not.toContain(SYSTEM_KEY);
  });

  it('throws LLM_NOT_CONFIGURED when the default key cannot be decrypted', async () => {
    state.rows = [llmRow('not-a-ciphertext')];
    await expect(resolveModelFor(USER_ID)).rejects.toMatchObject({
      status: 400,
      code: 'LLM_NOT_CONFIGURED',
    });
    expect(systemKey.reads()).toBe(0);
  });

  it('uses the user key when a default config decrypts', async () => {
    state.rows = [llmRow(encryptSecret('user-model-key'))];
    const resolved = await resolveModelFor(USER_ID);
    expect(resolved.apiKey).toBe('user-model-key');
    expect(resolved.source).toBe('user');
    expect(resolved.configId).toBe(CONFIG_ID);
    expect(systemKey.reads()).toBe(0);
  });

  it('keeps an explicit missing config as LlmConfigUnavailableError', async () => {
    state.rows = [];
    await expect(resolveModelFor(USER_ID, CONFIG_ID)).rejects.toBeInstanceOf(LlmConfigUnavailableError);
    await expect(resolveModelFor(USER_ID, CONFIG_ID)).rejects.toThrow('模型配置不存在');
    expect(systemKey.reads()).toBe(0);
  });
});
