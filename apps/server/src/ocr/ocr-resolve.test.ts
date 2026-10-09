import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { OcrConfigRow } from '../db/schema.js';
import { AppError } from '../errors.js';

const SYSTEM_KEY = 'system-dashscope-key-must-not-be-used';

vi.mock('../config.js', () => ({
  config: {
    DASHSCOPE_API_KEY: 'system-dashscope-key-must-not-be-used',
    LLM_KEY_ENCRYPTION_KEY: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
  },
}));

import { config } from '../config.js';

const state = vi.hoisted(() => ({
  rows: [] as unknown[],
}));

const completeOcrPage = vi.hoisted(() => vi.fn());

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

vi.mock('./ocr-api.js', () => ({
  completeOcrPage,
}));

vi.mock('../llm/usage.js', () => ({
  logLlmUsage: vi.fn(),
}));

import { encryptSecret } from '../llm/crypto.js';
import { resolveOcrFor, testOcrConfig } from './ocr.service.js';

const USER_ID = 'user-1';

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

function ocrRow(apiKeyEncrypted: string): OcrConfigRow {
  return {
    id: '22222222-2222-4222-8222-222222222222',
    userId: USER_ID,
    apiKeyEncrypted,
    model: 'qwen-vl-ocr',
    baseUrl: 'https://dashscope.example/compatible-mode/v1',
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

describe('resolveOcrFor', () => {
  let systemKey: ReturnType<typeof watchSystemKey>;

  beforeEach(() => {
    state.rows = [];
    completeOcrPage.mockReset();
    systemKey = watchSystemKey();
  });

  afterEach(() => {
    systemKey.restore();
  });

  it('throws LLM_NOT_CONFIGURED and does not read the system key when the user has no OCR config', async () => {
    const err = await resolveOcrFor(USER_ID).then(
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

  it('throws LLM_NOT_CONFIGURED when the OCR key cannot be decrypted', async () => {
    state.rows = [ocrRow('not-a-ciphertext')];
    await expect(resolveOcrFor(USER_ID)).rejects.toMatchObject({
      status: 400,
      code: 'LLM_NOT_CONFIGURED',
    });
    expect(systemKey.reads()).toBe(0);
  });

  it('uses the user key when an OCR config decrypts', async () => {
    state.rows = [ocrRow(encryptSecret('user-ocr-key'))];
    const resolved = await resolveOcrFor(USER_ID);
    expect(resolved).toMatchObject({
      apiKey: 'user-ocr-key',
      model: 'qwen-vl-ocr',
      baseUrl: 'https://dashscope.example/compatible-mode/v1',
      source: 'user',
    });
    expect(systemKey.reads()).toBe(0);
  });

  it('reports the missing model on the test endpoint without calling the provider', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('should not fetch'));
    try {
      await expect(testOcrConfig(USER_ID)).resolves.toEqual({
        ok: false,
        error: '还没有配置大模型',
      });
      expect(completeOcrPage).not.toHaveBeenCalled();
      expect(fetchSpy).not.toHaveBeenCalled();
      expect(systemKey.reads()).toBe(0);
    } finally {
      fetchSpy.mockRestore();
    }
  });
});
